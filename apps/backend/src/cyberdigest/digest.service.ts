import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { DigestConfigService } from './digest-config.service';
import { JobRunner } from './job-runner';
import { rewriteUrls } from './url-policy';
import { Cron } from '@nestjs/schedule';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { buildDigest, BuildInput, DigestContent, zonedDate, zonedMinutes, parseDigestTime, StoryRow, CveRow, DIGEST_TZ } from './digest.builder';
import { computeHealth } from './ingestion.service';
import { StoryReviewService } from './story-review.service';
import { Actor, ZeroDayService } from './zero-day.service';

const HOUR = 3600_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CVE_EVENTS = ['FIRST_VERIFIED', 'CVSS_CHANGED', 'KEV_STATUS_CHANGED', 'RECORD_STATUS_CHANGED', 'DESCRIPTION_CHANGED'];
const CORRECTION_EVENTS = ['CORRECTED', 'REJECTED', 'WITHDRAWN', 'AUTO_DEMOTED'];
const HISTORY_DIGESTS = 7; // how many earlier digests are checked so an item is not repeated
const GRACE_MS = 24 * HOUR; // an article that only became publishable after the last digest still belongs in this one
const MAX_CATCHUP_MS = 72 * HOUR;
const MIN_REASON = 5;

const FALLBACK_CONFIG = { timezone: DIGEST_TZ, publishTime: '08:00', publishMode: 'AUTO' as 'AUTO' | 'HOLD', minDiscoveryCoveragePct: 50, retentionDays: 365, linkHosts: [] as string[] };

/** Thrown when the checks that must pass before an automatic publication did not. The job fails, backs off and tries again; the previous digest stays. */
export class PublicationGateError extends Error {}

export interface DigestMeta {
  date: string;
  status: string;
  generatedAt: Date;
  windowStart: Date;
  windowEnd: Date;
  publishedAt: Date | null;
  withdrawnAt: Date | null;
  withdrawReason: string | null;
  generatedBy: 'schedule' | 'analyst';
  counts?: { news: number; research: number; cves: number; kev: number; zeroDays: number; corrections: number };
}

function idsFromContent(c: any): { storyIds: string[]; kevIds: string[]; zeroDayCves: string[] } {
  const groups = [...(c?.news ?? []), ...(c?.research?.portswigger ?? []), ...(c?.research?.cloudflare ?? [])];
  return {
    storyIds: groups.flatMap((g: any) => (g.sources ?? []).map((s: any) => s.storyId)),
    kevIds: (c?.kev ?? []).map((k: any) => k.cveId),
    zeroDayCves: (c?.zeroDays ?? []).map((z: any) => z.cveId),
  };
}

@Injectable()
export class DigestService {
  private readonly log = new Logger(DigestService.name);
  private running = false;

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
    private storyReview: StoryReviewService,
    private zeroDay: ZeroDayService,
    @Optional() private config?: DigestConfigService,
    @Optional() private runner?: JobRunner,
  ) {}

  private async cfg() {
    return this.config ? await this.config.get() : FALLBACK_CONFIG;
  }
  private async linkHosts(): Promise<Set<string>> {
    return new Set((await this.cfg()).linkHosts);
  }

  // ------------------------------------------------------------------------------------------------ gathering

  private async previous(date: string) {
    const rows = await this.prisma.digestIssue.findMany({ where: { digestDate: { lt: date }, status: { not: 'WITHDRAWN' } }, orderBy: { digestDate: 'desc' }, take: HISTORY_DIGESTS });
    const storyIds = new Set<string>();
    const kevIds = new Set<string>();
    const zeroDayCves = new Set<string>();
    for (const r of rows) {
      const ids = idsFromContent(r.content);
      ids.storyIds.forEach((x) => storyIds.add(x));
      ids.kevIds.forEach((x) => kevIds.add(x));
      ids.zeroDayCves.forEach((x) => zeroDayCves.add(x));
    }
    return { last: rows[0] ?? null, ids: { storyIds, kevIds, zeroDayCves } };
  }

  /** Everything below is read AFTER the verification pass, and only gate-passing records are selected. */
  async gather(now: Date, verificationPassFailed: boolean): Promise<BuildInput> {
    const conf = await this.cfg();
    const date = zonedDate(now, conf.timezone);
    const { last, ids } = await this.previous(date);
    const windowEnd = now;
    const windowStart = last ? new Date(Math.max(last.windowEnd.getTime(), now.getTime() - MAX_CATCHUP_MS)) : new Date(now.getTime() - 24 * HOUR);
    const lower = new Date(windowStart.getTime() - GRACE_MS);

    const storyRows = await this.prisma.digestStory.findMany({
      where: {
        verificationState: { in: ['ATTRIBUTED', 'VERIFIED'] },
        OR: [{ publishedAt: { gte: lower, lte: windowEnd } }, { publishedAt: null, ingestedAt: { gte: windowStart, lte: windowEnd } }],
      },
      include: { source: { select: { name: true, slug: true } } },
      orderBy: { ingestedAt: 'desc' },
      take: 500,
    });
    const stories: StoryRow[] = storyRows.map((s) => ({
      id: s.id, title: s.title, url: s.canonicalUrl, publisher: s.source.name, sourceSlug: s.source.slug, publishedAt: s.publishedAt, ingestedAt: s.ingestedAt,
      summary: s.summary, cveIds: s.cveIds, categories: s.categories, state: s.verificationState as 'ATTRIBUTED' | 'VERIFIED',
    }));

    const events = await this.prisma.digestEvent.findMany({ where: { createdAt: { gte: windowStart, lte: windowEnd }, OR: [{ entityType: 'CVE', event: { in: CVE_EVENTS } }, { entityType: { in: ['STORY', 'ZERODAY'] }, event: { in: CORRECTION_EVENTS } }] }, orderBy: { createdAt: 'asc' }, take: 2000 });
    const cveChanges = new Map<string, string[]>();
    for (const e of events.filter((x) => x.entityType === 'CVE')) cveChanges.set(e.entityId, [...(cveChanges.get(e.entityId) ?? []), e.event]);

    const wantCves = [...new Set([...cveChanges.keys(), ...stories.flatMap((s) => s.cveIds)])];
    const cveRows = wantCves.length ? await this.prisma.digestCve.findMany({ where: { cveId: { in: wantCves } } }) : [];
    const cves = new Map<string, CveRow>(cveRows.map((c) => [c.cveId, { cveId: c.cveId, recordStatus: c.recordStatus, description: c.description, cvss: (c.cvss as any) ?? [], maxCvssSeverity: c.maxCvssSeverity, kevListed: c.kevListed, nvdEnrichment: c.nvdEnrichment }]));

    const zdCases = wantCves.length ? await this.prisma.digestZeroDayCase.findMany({ where: { cveId: { in: wantCves } }, select: { cveId: true, state: true, approvedAt: true } }) : [];
    const zeroDayStateByCve = new Map(zdCases.map((c) => [c.cveId, c.state === 'CONFIRMED' && !c.approvedAt ? 'UNKNOWN' : (c.state as string)]));

    const kevFrom = new Date(Date.UTC(windowStart.getUTCFullYear(), windowStart.getUTCMonth(), windowStart.getUTCDate() - 1));
    const kev = (await this.prisma.digestKevEntry.findMany({ where: { dateAdded: { gte: kevFrom } }, take: 300 })).map((k) => ({
      cveId: k.cveId, vendorProject: k.vendorProject, product: k.product, name: k.name, dateAdded: k.dateAdded, dueDate: k.dueDate, ransomwareUse: k.ransomwareUse, shortDescription: k.shortDescription,
    }));

    const confirmed = await this.zeroDay.list('confirmed');
    const zeroDays = confirmed
      .filter((z) => z.approvedAt && new Date(z.approvedAt) >= windowStart && new Date(z.approvedAt) <= windowEnd)
      .map((z) => ({
        cveId: z.cveId, description: z.cve?.description ?? null, approvedBy: z.approvedBy, approvedAt: z.approvedAt ? new Date(z.approvedAt) : null,
        evidence: z.evidence.filter((e) => !e.retracted).map((e) => ({ kind: e.kind, sourceName: e.sourceName, url: e.url, eventDate: e.eventDate ? new Date(e.eventDate) : null, primary: e.primary })),
      }));

    const corrections = events
      .filter((e) => e.entityType !== 'CVE')
      .filter((e) => (e.entityType === 'STORY' ? ids.storyIds.has(e.entityId) : ids.zeroDayCves.has(e.entityId)))
      .map((e) => ({ kind: (e.entityType === 'STORY' ? 'story' : 'zero-day') as 'story' | 'zero-day', ref: e.entityType === 'STORY' ? e.entityId : e.entityId, event: e.event, reason: typeof (e.detail as any)?.reason === 'string' ? (e.detail as any).reason : null, at: e.createdAt }));

    const sources = await this.prisma.digestSource.findMany({ where: { enabled: true } });
    const unhealthySources = sources.map((s) => ({ s, h: computeHealth(s, now) })).filter((x) => x.h !== 'HEALTHY').map((x) => ({ name: x.s.name, health: x.h, lastSuccessAt: x.s.lastSuccessAt }));
    const kevSource = sources.find((s) => s.slug === 'cisa-kev');
    const discovery = sources.filter((s) => s.type === 'NEWS_RSS' || s.type === 'RESEARCH_RSS');
    const coverage = { healthy: discovery.filter((s) => computeHealth(s, now) === 'HEALTHY').length, total: discovery.length, minPct: conf.minDiscoveryCoveragePct };

    const [pendingStories, conflictingStories, zeroDayUnverified, cvesAwaitingNvd] = await Promise.all([
      this.prisma.digestStory.count({ where: { verificationState: 'PENDING' } }),
      this.prisma.digestStory.count({ where: { verificationState: 'CONFLICTING' } }),
      this.prisma.digestZeroDayCase.count({ where: { state: 'REPORTED_UNVERIFIED' } }),
      this.prisma.digestCve.count({ where: { recordStatus: 'PUBLISHED', nvdEnrichment: { not: 'ENRICHED' } } }),
    ]);

    return { date, windowStart, windowEnd, stories, cves, cveChanges, kev, zeroDays, zeroDayStateByCve, previous: ids, corrections, unhealthySources, counts: { pendingStories, conflictingStories, zeroDayUnverified, cvesAwaitingNvd }, kevRetrieved: !!kevSource?.lastSuccessAt, verificationPassFailed, tz: conf.timezone, coverage };
  }

  // --------------------------------------------------------------------------------------------- generating

  /** Re-run the checks that decide what may appear, so the digest is built from current states. */
  private async verificationPass(): Promise<boolean> {
    try {
      await this.zeroDay.syncKevCases();
      await this.zeroDay.syncStoryClaims();
      await this.zeroDay.recomputeAll();
      await this.storyReview.refresh();
      return true;
    } catch (e) {
      this.log.error(`Pre-digest verification pass failed: ${(e as Error).message}`);
      return false;
    }
  }

  async generate(opts: { actor?: Actor; now?: Date } = {}): Promise<DigestMeta> {
    const now = opts.now ?? new Date();
    const conf = await this.cfg();
    const date = zonedDate(now, conf.timezone);
    const existing = await this.prisma.digestIssue.findUnique({ where: { digestDate: date } });
    if (existing && existing.status !== 'SHADOW') throw new ConflictException(`The digest for ${date} is already ${existing.status.toLowerCase()}`);

    const passOk = await this.verificationPass();
    const input = await this.gather(now, !passOk);
    // Publication gate. Failing it never produces an empty or misleading digest: the previous one stays up (with its age)
    // and this job fails, backs off and tries again by itself.
    const problems: string[] = [];
    if (!passOk) problems.push('the verification pass failed');
    if (!input.kevRetrieved) problems.push('the CISA KEV catalog has not been retrieved');
    const c = input.coverage;
    if (c && c.total > 0 && (c.healthy === 0 || (c.healthy * 100) / c.total < c.minPct)) problems.push(`only ${c.healthy} of ${c.total} news and research sources are healthy (minimum ${c.minPct}%)`);
    if (problems.length && !opts.actor) throw new PublicationGateError(`Not published: ${problems.join('; ')}`);
    const content = buildDigest(input);
    // An administrator may still generate by hand (to look at a held or degraded digest): it is held for review, never auto-published.
    const status: 'SHADOW' | 'PUBLISHED' = problems.length || opts.actor || conf.publishMode === 'HOLD' ? 'SHADOW' : 'PUBLISHED';
    const data = { status, generatedAt: now, generatedById: opts.actor?.id ?? null, windowStart: new Date(content.windowStart), windowEnd: new Date(content.windowEnd), content: content as any, publishedAt: status === 'PUBLISHED' ? now : null, publishedById: null };
    let row;
    try {
      if (existing) {
        // The check at the top ran before a slow verification pass: only overwrite if the digest is STILL a shadow now,
        // decided by the database in the same statement, so a digest published meanwhile can never be rewritten.
        const r = await this.prisma.digestIssue.updateMany({ where: { digestDate: date, status: 'SHADOW' }, data });
        if (r.count === 0) throw new ConflictException(`The digest for ${date} changed while it was being regenerated`);
        row = await this.prisma.digestIssue.findUnique({ where: { digestDate: date } });
      } else {
        row = await this.prisma.digestIssue.create({ data: { digestDate: date, ...data } });
      }
      if (!row) throw new ConflictException(`The digest for ${date} disappeared while it was being generated`);
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException(`A digest for ${date} was created at the same moment`);
      throw e;
    }
    if (opts.actor) await this.audit.log({ actorId: opts.actor.id, action: 'CYBERDIGEST_DIGEST_GENERATED', targetType: 'DIGEST_ISSUE', targetId: row.id, details: { date, status }, ipAddress: opts.actor.ip, userAgent: opts.actor.userAgent });
    if (status === 'PUBLISHED') await this.notify(row.id, date, content);
    return this.meta(row);
  }

  // ponytail: a 5-minute tick that generates once the IST clock passes the configured time and none exists for today; survives restarts and missed ticks.
  @Cron('*/5 * * * *')
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      // Through the runner: paused pipeline, cross-instance lease, run history and exponential retry apply.
      // A conflict (another instance published first) is not a failure.
      if (this.runner) {
        await this.runner.run('digest', async () => {
          try {
            return { generated: await this.runScheduled(now) };
          } catch (e) {
            if (e instanceof ConflictException) return { generated: false, note: 'already handled' };
            throw e;
          }
        }, { now });
      } else {
        await this.runScheduled(now);
      }
      if (this.runner) await this.runner.run('retention', () => this.pruneOld(now), { requirePipeline: false, now });
    } catch (e) {
      if (!(e instanceof ConflictException)) this.log.error(`Scheduled digest failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Generates today's digest once the clock in the configured timezone is past the configured time and none exists yet.
   * Because it only asks "is there one for today?", a restart, a missed tick or a failed attempt is simply retried on
   * the next tick, and repeating it can never create a second digest (the date is unique and writes are conditional).
   */
  async runScheduled(now: Date): Promise<boolean> {
    const conf = await this.cfg();
    if (zonedMinutes(now, conf.timezone) < parseDigestTime(conf.publishTime)) return false;
    if (await this.prisma.digestIssue.findUnique({ where: { digestDate: zonedDate(now, conf.timezone) } })) return false;
    await this.generate({ now });
    return true;
  }

  /** Old digests, job history and expired events are removed after the configured retention. The newest published digest is always kept. */
  async pruneOld(now: Date): Promise<{ digests: number; runs: number; stories: number; rawItems: number; events: number }> {
    const conf = await this.cfg();
    const cutoff = new Date(now.getTime() - conf.retentionDays * 86_400_000);
    const newest = await this.prisma.digestIssue.findFirst({ where: { status: 'PUBLISHED' }, orderBy: { digestDate: 'desc' }, select: { id: true, content: true } });
    const digests = await this.prisma.digestIssue.deleteMany({ where: { generatedAt: { lt: cutoff }, ...(newest ? { id: { not: newest.id } } : {}) } });
    const runs = await this.prisma.digestJobRun.deleteMany({ where: { startedAt: { lt: new Date(now.getTime() - 90 * 86_400_000) } } });
    // Collected material ages out on the same schedule. Stories the newest digest still links to are kept, because the
    // digest is a frozen snapshot that points at them. The audit log, CVE records and zero-day cases/evidence are not touched.
    // "Surviving" = every digest generated within retention, plus the newest published one: all of them show correction flags.
    const surviving = await this.prisma.digestIssue.findMany({ where: { OR: [{ generatedAt: { gte: cutoff } }, ...(newest ? [{ id: newest.id }] : [])] }, select: { content: true } });
    const keepIds = [...new Set(surviving.flatMap((d) => idsFromContent(d.content).storyIds))];
    const stories = await this.prisma.digestStory.deleteMany({ where: { ingestedAt: { lt: cutoff }, ...(keepIds.length ? { id: { notIn: keepIds } } : {}) } });
    const rawItems = await this.prisma.digestRawItem.deleteMany({ where: { fetchedAt: { lt: cutoff } } });
    // Correction history (rejected / corrected / withdrawn) of stories a surviving digest links to is kept with them.
    const events = await this.prisma.digestEvent.deleteMany({ where: { createdAt: { lt: cutoff }, entityType: { in: ['STORY', 'SOURCE', 'JOB'] }, NOT: { entityType: 'STORY', entityId: { in: keepIds } } } });
    return { digests: digests.count, runs: runs.count, stories: stories.count, rawItems: rawItems.count, events: events.count };
  }

  // ------------------------------------------------------------------------------------------------ publishing

  private reason(v: unknown): string {
    const r = typeof v === 'string' ? v.trim() : '';
    if (r.length < MIN_REASON) throw new BadRequestException('A reason is required');
    return r.slice(0, 1000);
  }
  private checkDate(date: string) {
    if (!DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new BadRequestException('Invalid digest date');
  }

  async publish(date: string, actor: Actor): Promise<DigestMeta> {
    this.checkDate(date);
    const row = await this.prisma.digestIssue.findUnique({ where: { digestDate: date } });
    if (!row) throw new NotFoundException('No digest for that date');
    if (row.status !== 'SHADOW') throw new ConflictException(`The digest is already ${row.status.toLowerCase()}`);
    // Conditional on still being a shadow, so two people publishing at once notify everyone exactly once.
    const r = await this.prisma.digestIssue.updateMany({ where: { digestDate: date, status: 'SHADOW' }, data: { status: 'PUBLISHED', publishedAt: new Date(), publishedById: actor.id } });
    if (r.count === 0) throw new ConflictException('The digest was published or withdrawn by someone else');
    const updated = (await this.prisma.digestIssue.findUnique({ where: { digestDate: date } }))!;
    await this.audit.log({ actorId: actor.id, action: 'CYBERDIGEST_DIGEST_PUBLISHED', targetType: 'DIGEST_ISSUE', targetId: row.id, details: { date }, ipAddress: actor.ip, userAgent: actor.userAgent });
    await this.notify(row.id, date, row.content as unknown as DigestContent);
    return this.meta(updated);
  }

  async withdraw(date: string, reason: unknown, actor: Actor): Promise<DigestMeta> {
    this.checkDate(date);
    const why = this.reason(reason);
    const row = await this.prisma.digestIssue.findUnique({ where: { digestDate: date } });
    if (!row) throw new NotFoundException('No digest for that date');
    if (row.status === 'WITHDRAWN') throw new ConflictException('Already withdrawn');
    const was = row.status;
    const r = await this.prisma.digestIssue.updateMany({ where: { digestDate: date, status: { in: ['SHADOW', 'PUBLISHED'] } }, data: { status: 'WITHDRAWN', withdrawnAt: new Date(), withdrawnById: actor.id, withdrawReason: why } });
    if (r.count === 0) throw new ConflictException('Already withdrawn');
    const updated = (await this.prisma.digestIssue.findUnique({ where: { digestDate: date } }))!;
    await this.audit.log({ actorId: actor.id, action: 'CYBERDIGEST_DIGEST_WITHDRAWN', targetType: 'DIGEST_ISSUE', targetId: row.id, details: { date, reason: why, was }, ipAddress: actor.ip, userAgent: actor.userAgent });
    return this.meta(updated);
  }

  /** One in-app notification per active user (the Admin's per-role switches still apply). A failure for one user never blocks the rest. */
  private async notify(issueId: string, date: string, content: DigestContent) {
    const users = await this.prisma.user.findMany({ where: { isActive: true }, select: { id: true } });
    const first = content.executiveSummary.lines[0] ?? '';
    for (const u of users) {
      try {
        await this.notifications.create({ userId: u.id, type: 'CYBERDIGEST_DIGEST', title: `Cyberdigest for ${date}`, message: first.slice(0, 300), linkUrl: '/dashboard/cyberdigest', relatedId: issueId });
      } catch (e) {
        this.log.warn(`Could not notify a user about the digest: ${(e as Error).message}`);
      }
    }
  }

  // ---------------------------------------------------------------------------------------------------- reading

  private meta(r: any): DigestMeta {
    const c = r.content as any;
    return {
      date: r.digestDate, status: r.status, generatedAt: r.generatedAt, windowStart: r.windowStart, windowEnd: r.windowEnd, publishedAt: r.publishedAt, withdrawnAt: r.withdrawnAt, withdrawReason: r.withdrawReason,
      generatedBy: r.generatedById ? 'analyst' : 'schedule',
      counts: c ? { news: (c.news ?? []).length, research: (c.research?.portswigger ?? []).length + (c.research?.cloudflare ?? []).length, cves: (c.cves ?? []).length, kev: (c.kev ?? []).length, zeroDays: (c.zeroDays ?? []).length, corrections: (c.corrections ?? []).length } : undefined,
    };
  }

  /** Reviewers see everything; everyone else sees published digests, and only the fact of a withdrawal. */
  async list(canReview: boolean): Promise<DigestMeta[]> {
    const rows = await this.prisma.digestIssue.findMany({ where: canReview ? {} : { status: { in: ['PUBLISHED', 'WITHDRAWN'] } }, orderBy: { digestDate: 'desc' }, take: 60 });
    return rows.map((r) => this.meta(r));
  }

  /**
   * What people see by default: the newest published digest, and how old it is. If today's digest could not be published
   * (sources down, pipeline paused), this is still the previous one, clearly dated, never an empty or invented one.
   */
  async latest(canReview: boolean, now = new Date()) {
    const conf = await this.cfg();
    const row = await this.prisma.digestIssue.findFirst({ where: { status: 'PUBLISHED' }, orderBy: { digestDate: 'desc' } });
    const today = zonedDate(now, conf.timezone);
    if (!row) return { today, latest: null, stale: true, ageHours: null, pipelineEnabled: this.config ? (await this.config.get()).pipelineEnabled : true };
    const age = Math.max(0, Math.round(((now.getTime() - (row.publishedAt ?? row.generatedAt).getTime()) / 3600_000) * 10) / 10);
    const view = await this.get(row.digestDate, canReview);
    return {
      today, latest: view, stale: row.digestDate !== today, ageHours: age, publishedFor: row.digestDate,
      pipelineEnabled: this.config ? (await this.config.get()).pipelineEnabled : true,
    };
  }

  async get(date: string, canReview: boolean) {
    this.checkDate(date);
    const row = await this.prisma.digestIssue.findUnique({ where: { digestDate: date } });
    if (!row || (row.status === 'SHADOW' && !canReview)) throw new NotFoundException('No digest for that date');
    const meta = this.meta(row);
    if (row.status === 'WITHDRAWN' && !canReview) return { meta, content: null, overlay: null };
    // Stored content is untrusted: every link in it is re-validated now, against today's allowlist, before it reaches a browser.
    const content = rewriteUrls(row.content as unknown as DigestContent, await this.linkHosts());

    // Corrections made after generation are shown on top of the frozen content; the content itself is never edited.
    const ids = idsFromContent(content);
    const [stories, cases] = await Promise.all([
      ids.storyIds.length ? this.prisma.digestStory.findMany({ where: { id: { in: ids.storyIds } }, select: { id: true, verificationState: true, stateNote: true } }) : [],
      ids.zeroDayCves.length ? this.prisma.digestZeroDayCase.findMany({ where: { cveId: { in: ids.zeroDayCves } }, select: { cveId: true, state: true, approvedAt: true } }) : [],
    ]);
    const storyFlags: Record<string, { state: string; note: string | null }> = {};
    for (const s of stories) if (s.verificationState === 'REJECTED' || s.verificationState === 'CONFLICTING') storyFlags[s.id] = { state: s.verificationState, note: s.stateNote };
    const zeroDayFlags: Record<string, { state: string }> = {};
    for (const c of cases) if (c.state !== 'CONFIRMED' || !c.approvedAt) zeroDayFlags[c.cveId] = { state: c.state };
    return { meta, content, overlay: { storyFlags, zeroDayFlags } };
  }
}
