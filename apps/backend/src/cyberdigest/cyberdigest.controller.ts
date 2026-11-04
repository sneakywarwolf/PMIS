import { BadRequestException, Body, Controller, Delete, Get, Injectable, NotFoundException, Param, Patch, PipeTransform, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AdminOnly, CyberdigestAccessGuard } from './access.guard';
import { CATEGORIES } from './classify';
import { isValidCveId } from './cve-clients';
import { DigestConfigService } from './digest-config.service';
import { DigestService } from './digest.service';
import { computeHealth, IngestionService } from './ingestion.service';
import { JobRunner } from './job-runner';
import { StoryReviewService } from './story-review.service';
import { linkFor } from './url-policy';
import { Actor, EvidenceInput, ZeroDayService } from './zero-day.service';

/** `?q=a&q=b` or `?q[x]=1` arrive as arrays/objects; every filter here is a single string, so anything else is treated as absent. */
@Injectable()
export class StrOnly implements PipeTransform {
  transform(v: unknown) {
    return typeof v === 'string' ? v : undefined;
  }
}

const clampInt = (v: string | undefined, def: number, min: number, max: number) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const parseDate = (v?: string) => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? new Date(t) : undefined;
};
const BULK_MAX = 100;
/** States ordinary readers may ever see. Pending, conflicting and rejected items are working material for administrators. */
const PUBLIC_STORY_STATES = ['ATTRIBUTED', 'VERIFIED'];

/**
 * Authorization is decided in one place (CyberdigestAccessGuard): administrators do everything; every other role is a
 * read-only consumer, only while the administrator's availability switch is on, and only on routes not marked AdminOnly.
 * Everything a reader receives is also trimmed here (no internal ids, user names, error text or review notes), and every
 * external link is re-validated against the administrator's allowlist before it leaves the server.
 */
@ApiTags('Cyberdigest')
@Controller('cyberdigest')
@UseGuards(CyberdigestAccessGuard)
export class CyberdigestController {
  constructor(
    private prisma: PrismaService,
    private zeroDay: ZeroDayService,
    private storyReview: StoryReviewService,
    private ingestion: IngestionService,
    private audit: AuditService,
    private digest: DigestService,
    private config: DigestConfigService,
    private runner: JobRunner,
  ) {}

  private actor(user: User, req: Request): Actor {
    return { id: user.id, ip: req.ip ?? '', userAgent: String(req.headers['user-agent'] ?? '') };
  }
  private isAdmin(user: User) {
    return user.role === 'ADMIN';
  }

  // ------------------------------------------------------------------ access + administration

  @Get('access')
  @ApiOperation({ summary: 'Whether the caller may use Cyberdigest (drives the menu entry; the server enforces it on every route)' })
  async access(@CurrentUser() user: User) {
    return { admin: this.isAdmin(user), enabled: true };
  }

  @Get('admin/config')
  @AdminOnly()
  async getConfig() {
    return this.config.get();
  }

  @Patch('admin/config')
  @AdminOnly()
  @ApiOperation({ summary: 'Change module settings (availability, pipeline, schedule, timezone, coverage, retention). Audited with before/after.' })
  async setConfig(@Body() body: Record<string, unknown>, @CurrentUser() user: User, @Req() req: Request) {
    return this.config.update(body, this.actor(user, req));
  }

  @Post('admin/link-hosts')
  @AdminOnly()
  async addLinkHost(@Body() body: { host?: unknown }, @CurrentUser() user: User, @Req() req: Request) {
    return { linkHosts: await this.config.addLinkHost(body?.host, this.actor(user, req)) };
  }

  @Delete('admin/link-hosts/:host')
  @AdminOnly()
  async removeLinkHost(@Param('host') host: string, @CurrentUser() user: User, @Req() req: Request) {
    return { linkHosts: await this.config.removeLinkHost(host, this.actor(user, req)) };
  }

  @Post('admin/sources')
  @AdminOnly()
  @ApiOperation({ summary: 'Add a news/research feed. One action: the server may fetch it and users may click through to its site.' })
  async addSource(@Body() body: { name?: unknown; endpoint?: unknown; website?: unknown }, @CurrentUser() user: User, @Req() req: Request) {
    const s = await this.config.addSource(body, this.actor(user, req));
    return { slug: s.slug, name: s.name };
  }

  @Get('admin/jobs')
  @AdminOnly()
  @ApiOperation({ summary: 'Per-job last success, last run, failure streak, and next scheduled digest time' })
  async jobs() {
    const cfg = await this.config.get();
    return { pipelineEnabled: cfg.pipelineEnabled, publishTime: cfg.publishTime, timezone: cfg.timezone, jobs: await this.runner.status() };
  }

  @Get('admin/jobs/history')
  @AdminOnly()
  async jobHistory(@Query('job', StrOnly) job?: string, @Query('take', StrOnly) take?: string) {
    return { items: await this.runner.history(job, clampInt(take, 50, 1, 200)) };
  }

  @Get('health')
  @AdminOnly()
  @ApiOperation({ summary: 'Per-source ingestion health. Never reports "all healthy" while an enabled source is not.' })
  async health() {
    const allowed = await this.config.linkHostSet();
    const [sources, pendingStories] = await Promise.all([
      this.prisma.digestSource.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.digestStory.count({ where: { verificationState: 'PENDING' } }),
    ]);
    const now = new Date();
    const rows = sources.map((s) => ({
      slug: s.slug, name: s.name, type: s.type, website: linkFor(s.website, allowed).href, trustRole: s.trustRole, enabled: s.enabled, pollIntervalMinutes: s.pollIntervalMinutes,
      health: computeHealth(s, now), lastAttemptAt: s.lastAttemptAt, lastSuccessAt: s.lastSuccessAt, lastError: s.lastError, consecutiveFailures: s.consecutiveFailures,
    }));
    const enabled = rows.filter((r) => r.enabled);
    return {
      checkedAt: now,
      allEnabledSourcesHealthy: enabled.length > 0 && enabled.every((r) => r.health === 'HEALTHY'),
      coverageGaps: rows.filter((r) => !r.enabled).map((r) => r.slug),
      pendingStories,
      sources: rows,
    };
  }

  // ---------------------------------------------------------------------------- CVEs

  private async cveView(r: any, admin: boolean, allowed: ReadonlySet<string>) {
    const refs = Array.isArray(r.references) ? (r.references as { url?: string; name?: string }[]).map((x) => ({ ...(x.name && { name: x.name }), ...pick(linkFor(x.url, allowed)) })) : [];
    return {
      cveId: r.cveId,
      recordStatus: r.recordStatus,
      description: r.description,
      recordPublishedAt: r.recordPublishedAt,
      recordUpdatedAt: r.recordUpdatedAt,
      cvss: r.cvss ?? [],
      vendors: r.vendors ?? [],
      nvd: { enrichment: r.nvdEnrichment, status: r.nvdStatus, lastModified: r.nvdLastModified },
      kev: { listed: r.kevListed, dateAdded: r.kevDateAdded, details: r.kevData },
      affected: r.affected,
      nvdAffected: r.nvdAffected,
      references: refs,
      conflicts: r.conflicts,
      lastVerifiedAt: r.lastVerifiedAt,
      ...(admin && { provenance: r.provenance, lastAttemptAt: r.lastAttemptAt, lastError: r.lastError }),
    };
  }

  @Get('cves')
  @ApiOperation({ summary: 'CVE records verified against CVE.org / NVD / CISA KEV' })
  async cves(@CurrentUser() user: User, @Query('q', StrOnly) q?: string, @Query('status', StrOnly) status?: string, @Query('kev', StrOnly) kev?: string, @Query('nvd', StrOnly) nvd?: string, @Query('severity', StrOnly) severity?: string, @Query('vendor', StrOnly) vendor?: string, @Query('take', StrOnly) take?: string, @Query('skip', StrOnly) skip?: string) {
    const where: any = {};
    if (severity && ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(severity.toUpperCase())) where.maxCvssSeverity = severity.toUpperCase();
    if (vendor && vendor.trim()) where.vendors = { has: vendor.trim().toLowerCase().slice(0, 80) };
    if (q) where.OR = [{ cveId: { contains: q.trim().toUpperCase().slice(0, 40) } }, { description: { contains: q.slice(0, 100), mode: 'insensitive' } }];
    if (status && ['PUBLISHED', 'RESERVED', 'REJECTED', 'NOT_FOUND', 'UNAVAILABLE'].includes(status)) where.recordStatus = status;
    if (kev === 'true') where.kevListed = true;
    else if (kev === 'false') where.kevListed = false;
    else if (kev === 'unknown') where.kevListed = null;
    if (nvd && ['PENDING', 'ENRICHED', 'UNAVAILABLE'].includes(nvd)) where.nvdEnrichment = nvd;
    const admin = this.isAdmin(user);
    // Readers see CVEs the official record confirms; unresolved lookups are working material.
    if (!admin) where.recordStatus = where.recordStatus && ['PUBLISHED', 'REJECTED'].includes(where.recordStatus) ? where.recordStatus : { in: ['PUBLISHED', 'REJECTED'] };
    const allowed = await this.config.linkHostSet();
    const [total, rows] = await Promise.all([
      this.prisma.digestCve.count({ where }),
      this.prisma.digestCve.findMany({ where, orderBy: [{ kevListed: { sort: 'desc', nulls: 'last' } }, { recordUpdatedAt: { sort: 'desc', nulls: 'last' } }], take: clampInt(take, 25, 1, 100), skip: clampInt(skip, 0, 0, 100000) }),
    ]);
    return { total, items: await Promise.all(rows.map((r) => this.cveView(r, admin, allowed))) };
  }

  @Get('cves/:id')
  @ApiOperation({ summary: 'One verified CVE (administrators also get its change history)' })
  async cve(@Param('id') id: string, @CurrentUser() user: User) {
    const cveId = id.trim().toUpperCase();
    if (!isValidCveId(cveId)) throw new BadRequestException('Malformed CVE id');
    const row = await this.prisma.digestCve.findUnique({ where: { cveId } });
    const admin = this.isAdmin(user);
    if (!row || (!admin && !['PUBLISHED', 'REJECTED'].includes(row.recordStatus))) throw new NotFoundException('CVE has not been verified yet');
    const view = await this.cveView(row, admin, await this.config.linkHostSet());
    if (!admin) return view;
    const history = await this.prisma.digestEvent.findMany({ where: { entityType: 'CVE', entityId: cveId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return { ...view, history };
  }

  // ------------------------------------------------------------------------ zero-days

  /** Readers get the conclusion and its evidence links, not who recorded what or the reviewer's notes. */
  private async zdForReader(v: any, allowed: ReadonlySet<string>) {
    return {
      cveId: v.cveId, state: v.state, publishedAsConfirmed: v.publishedAsConfirmed, reasons: v.reasons, missing: v.missing, conflicts: v.conflicts,
      approvedAt: v.approvedAt, cve: v.cve,
      evidence: v.evidence.filter((e: any) => !e.retracted).map((e: any) => ({ kind: e.kind, sourceType: e.sourceType, primary: e.primary, sourceName: e.sourceName, eventDate: e.eventDate, ...pick(linkFor(e.url, allowed)) })),
    };
  }
  private async zdForAdmin(v: any, allowed: ReadonlySet<string>) {
    return { ...v, evidence: v.evidence.map((e: any) => ({ ...e, ...pick(linkFor(e.url, allowed)) })) };
  }

  @Get('zero-days')
  @ApiOperation({ summary: 'Zero-day cases by section: confirmed (approved only), known_exploited, review (administrators only)' })
  async zeroDays(@CurrentUser() user: User, @Query('section', StrOnly) section?: string) {
    const admin = this.isAdmin(user);
    const s = section === 'confirmed' || section === 'known_exploited' ? section : 'review';
    if (s === 'review' && !admin) throw new BadRequestException('Not available');
    const allowed = await this.config.linkHostSet();
    const items = await this.zeroDay.list(s);
    return { section: s, items: await Promise.all(items.map((v) => (admin ? this.zdForAdmin(v, allowed) : this.zdForReader(v, allowed)))) };
  }

  @Get('zero-days/:id')
  async zeroDay1(@Param('id') id: string, @CurrentUser() user: User) {
    const cveId = id.trim().toUpperCase();
    if (!isValidCveId(cveId)) throw new BadRequestException('Malformed CVE id');
    const v = await this.zeroDay.view(cveId);
    const admin = this.isAdmin(user);
    if (!admin && !['CONFIRMED', 'KNOWN_EXPLOITED_UNCONFIRMED'].includes(v.state)) throw new NotFoundException('No zero-day case for this CVE');
    if (!admin && v.state === 'CONFIRMED' && !v.publishedAsConfirmed) throw new NotFoundException('No zero-day case for this CVE');
    const allowed = await this.config.linkHostSet();
    return admin ? this.zdForAdmin(v, allowed) : this.zdForReader(v, allowed);
  }

  @Post('zero-days/:id/evidence')
  @AdminOnly()
  @ApiOperation({ summary: 'Record evidence for a zero-day case' })
  async addEvidence(@Param('id') id: string, @Body() body: EvidenceInput, @CurrentUser() user: User, @Req() req: Request) {
    await this.zeroDay.addEvidence(id, body, this.actor(user, req));
    return this.zdForAdmin(await this.zeroDay.view(id.trim().toUpperCase()), await this.config.linkHostSet());
  }

  @Post('zero-days/evidence/:evidenceId/retract')
  @AdminOnly()
  async retract(@Param('evidenceId') evidenceId: string, @Body() body: { reason?: string }, @CurrentUser() user: User, @Req() req: Request) {
    await this.zeroDay.retractEvidence(evidenceId, body?.reason, this.actor(user, req));
    return { ok: true };
  }

  @Post('zero-days/:id/transition')
  @AdminOnly()
  async transition(@Param('id') id: string, @Body() body: { state?: string; reason?: string }, @CurrentUser() user: User, @Req() req: Request) {
    await this.zeroDay.transition(id, String(body?.state ?? ''), body?.reason, this.actor(user, req));
    return this.zdForAdmin(await this.zeroDay.view(id.trim().toUpperCase()), await this.config.linkHostSet());
  }

  @Post('zero-days/bulk-approve')
  @AdminOnly()
  @ApiOperation({ summary: 'Approve several eligible zero-day cases at once. Each is checked against the evidence rules on its own.' })
  async bulkApproveZeroDays(@Body() body: { cveIds?: unknown }, @CurrentUser() user: User, @Req() req: Request) {
    const ids = idList(body?.cveIds).map((x) => String(x).trim().toUpperCase());
    if (!ids.length) throw new BadRequestException('Select at least one case');
    const a = this.actor(user, req);
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of ids) {
      try {
        await this.zeroDay.approve(id, a);
        results.push({ id, ok: true });
      } catch (e: any) {
        results.push({ id, ok: false, error: typeof e?.getResponse === 'function' ? String(e.getResponse()?.message ?? e.message) : 'failed' });
      }
    }
    await this.audit.log({ actorId: a.id, action: 'CYBERDIGEST_BULK_APPROVED', targetType: 'ZERODAY_CASE', details: { kind: 'zero-day', requested: ids.length, approved: results.filter((r) => r.ok).length, ids }, ipAddress: a.ip, userAgent: a.userAgent });
    return { results };
  }

  @Post('zero-days/:id/approve')
  @AdminOnly()
  @ApiOperation({ summary: 'Approve a zero-day as CONFIRMED. Refused unless the evidence rules are met.' })
  async approve(@Param('id') id: string, @CurrentUser() user: User, @Req() req: Request) {
    await this.zeroDay.approve(id, this.actor(user, req));
    return this.zdForAdmin(await this.zeroDay.view(id.trim().toUpperCase()), await this.config.linkHostSet());
  }

  @Post('zero-days/:id/withdraw')
  @AdminOnly()
  async withdraw(@Param('id') id: string, @Body() body: { state?: string; reason?: string }, @CurrentUser() user: User, @Req() req: Request) {
    await this.zeroDay.withdraw(id, String(body?.state ?? 'REPORTED_UNVERIFIED'), body?.reason, this.actor(user, req));
    return this.zdForAdmin(await this.zeroDay.view(id.trim().toUpperCase()), await this.config.linkHostSet());
  }

  // ------------------------------------------------------------------------- stories

  @Get('stories')
  @ApiOperation({ summary: 'Stories with their publication state. Readers see only attributed or verified stories.' })
  async stories(
    @CurrentUser() user: User,
    @Query('q', StrOnly) q?: string, @Query('from', StrOnly) from?: string, @Query('to', StrOnly) to?: string, @Query('source', StrOnly) source?: string,
    @Query('category', StrOnly) category?: string, @Query('state', StrOnly) state?: string, @Query('take', StrOnly) take?: string, @Query('skip', StrOnly) skip?: string,
  ) {
    const admin = this.isAdmin(user);
    const gte = parseDate(from);
    const lte = parseDate(to);
    const where: any = admin ? { verificationState: { not: 'REJECTED' } } : { verificationState: { in: PUBLIC_STORY_STATES } };
    const states = admin ? ['PENDING', 'ATTRIBUTED', 'VERIFIED', 'CONFLICTING', 'REJECTED', 'SOURCE_UNAVAILABLE'] : PUBLIC_STORY_STATES;
    if (state && states.includes(state)) where.verificationState = state;
    if (q) where.OR = [{ title: { contains: q.slice(0, 100), mode: 'insensitive' } }, { cveIds: { has: q.trim().toUpperCase().slice(0, 40) } }];
    if (gte || lte) where.publishedAt = { ...(gte && { gte }), ...(lte && { lte }) };
    if (source) where.source = { slug: source.slice(0, 60) };
    if (category && (CATEGORIES as readonly string[]).includes(category)) where.categories = { has: category };
    const allowed = await this.config.linkHostSet();
    const [total, rows] = await Promise.all([
      this.prisma.digestStory.count({ where }),
      this.prisma.digestStory.findMany({
        where,
        orderBy: [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { ingestedAt: 'desc' }],
        take: clampInt(take, 25, 1, 100),
        skip: clampInt(skip, 0, 0, 100000),
        include: { source: { select: { slug: true, name: true } } },
      }),
    ]);
    const ids = [...new Set(rows.flatMap((r) => r.cveIds))];
    const [cves, cases] = ids.length
      ? await Promise.all([
          this.prisma.digestCve.findMany({ where: { cveId: { in: ids } }, select: { cveId: true, recordStatus: true } }),
          this.prisma.digestZeroDayCase.findMany({ where: { cveId: { in: ids } }, select: { cveId: true, state: true, approvedAt: true } }),
        ])
      : [[], []];
    const status = new Map(cves.map((c) => [c.cveId, c.recordStatus]));
    // A zero-day label counts only if the case is really confirmed-and-approved, or known-exploited; never from the article's wording.
    const zd = new Map(cases.filter((c) => (c.state === 'CONFIRMED' ? !!c.approvedAt : c.state === 'KNOWN_EXPLOITED_UNCONFIRMED' || admin)).map((c) => [c.cveId, c.state]));
    return {
      total,
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        ...pick(linkFor(r.canonicalUrl, allowed)),
        publisher: r.source.name,
        sourceSlug: r.source.slug,
        author: r.author,
        publishedAt: r.publishedAt,
        ingestedAt: r.ingestedAt,
        summary: r.summary,
        categories: r.categories,
        cves: r.cveIds.map((id) => ({ cveId: id, recordStatus: status.get(id) ?? null })),
        zeroDay: r.cveIds.filter((id) => zd.has(id) && zd.get(id) !== 'UNKNOWN').map((id) => ({ cveId: id, state: zd.get(id) })),
        verificationState: r.verificationState,
        lastVerifiedAt: r.lastVerifiedAt,
        ...(admin && { stateNote: r.stateNote, reviewedAt: r.reviewedAt }),
      })),
    };
  }

  @Post('stories/bulk-approve')
  @AdminOnly()
  @ApiOperation({ summary: 'Verify several attributed stories at once with one reason. Each is checked on its own.' })
  async bulkApproveStories(@Body() body: { ids?: unknown; reason?: string }, @CurrentUser() user: User, @Req() req: Request) {
    const ids = idList(body?.ids).map((x) => String(x));
    if (!ids.length) throw new BadRequestException('Select at least one story');
    const a = this.actor(user, req);
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of ids) {
      try {
        await this.storyReview.approve(id, body?.reason, a);
        results.push({ id, ok: true });
      } catch (e: any) {
        results.push({ id, ok: false, error: typeof e?.getResponse === 'function' ? String(e.getResponse()?.message ?? e.message) : 'failed' });
      }
    }
    await this.audit.log({ actorId: a.id, action: 'CYBERDIGEST_BULK_APPROVED', targetType: 'DIGEST_STORY', details: { kind: 'story', requested: ids.length, approved: results.filter((r) => r.ok).length, ids }, ipAddress: a.ip, userAgent: a.userAgent });
    return { results };
  }

  @Post('stories/:id/approve')
  @AdminOnly()
  async approveStory(@Param('id') id: string, @Body() body: { reason?: string }, @CurrentUser() user: User, @Req() req: Request) {
    await this.storyReview.approve(id, body?.reason, this.actor(user, req));
    return { ok: true };
  }

  @Post('stories/:id/reject')
  @AdminOnly()
  async rejectStory(@Param('id') id: string, @Body() body: { reason?: string }, @CurrentUser() user: User, @Req() req: Request) {
    await this.storyReview.reject(id, body?.reason, this.actor(user, req));
    return { ok: true };
  }

  @Post('stories/:id/correct')
  @AdminOnly()
  async correctStory(@Param('id') id: string, @Body() body: { reason?: string }, @CurrentUser() user: User, @Req() req: Request) {
    await this.storyReview.correct(id, body?.reason, this.actor(user, req));
    return { ok: true };
  }

  // -------------------------------------------------------- verification overview

  @Get('verification')
  @AdminOnly()
  @ApiOperation({ summary: 'What is still unverified, disputed or corrected' })
  async verification() {
    const allowed = await this.config.linkHostSet();
    const [pending, conflicting, nvdPending, cveUnavailable, cveConflicts, zdReported, zdUnknown, rejected, corrections] = await Promise.all([
      this.prisma.digestStory.count({ where: { verificationState: 'PENDING' } }),
      this.prisma.digestStory.findMany({ where: { verificationState: 'CONFLICTING' }, select: { id: true, title: true, canonicalUrl: true, stateNote: true }, take: 20, orderBy: { ingestedAt: 'desc' } }),
      this.prisma.digestCve.count({ where: { recordStatus: 'PUBLISHED', nvdEnrichment: { not: 'ENRICHED' } } }),
      this.prisma.digestCve.count({ where: { recordStatus: 'UNAVAILABLE' } }),
      this.prisma.digestCve.findMany({ where: { NOT: { conflicts: { equals: Prisma.DbNull } } }, select: { cveId: true, conflicts: true }, take: 20 }),
      this.prisma.digestZeroDayCase.count({ where: { state: 'REPORTED_UNVERIFIED' } }),
      this.prisma.digestZeroDayCase.count({ where: { state: 'UNKNOWN' } }),
      this.prisma.digestStory.findMany({ where: { verificationState: 'REJECTED' }, select: { id: true, title: true, canonicalUrl: true, stateNote: true, reviewedAt: true }, take: 20, orderBy: { reviewedAt: 'desc' } }),
      this.prisma.digestEvent.findMany({ where: { entityType: { in: ['STORY', 'ZERODAY'] }, event: { in: ['CORRECTED', 'WITHDRAWN', 'AUTO_DEMOTED'] } }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    const withLink = <T extends { canonicalUrl: string }>(r: T) => { const { canonicalUrl, ...rest } = r; return { ...rest, ...pick(linkFor(canonicalUrl, allowed)) }; };
    return {
      pendingStories: pending,
      conflictingStories: conflicting.map(withLink),
      cvesAwaitingNvd: nvdPending,
      cvesUnavailable: cveUnavailable,
      cveConflicts,
      zeroDayClaimsUnverified: zdReported,
      zeroDayStatusUnknown: zdUnknown,
      rejectedStories: rejected.map(withLink),
      corrections: corrections.map((c) => ({ id: c.id, entityType: c.entityType, entityId: c.entityId, event: c.event, createdAt: c.createdAt, detail: { reason: typeof (c.detail as any)?.reason === 'string' ? (c.detail as any).reason : undefined, from: (c.detail as any)?.from, to: (c.detail as any)?.to } })),
    };
  }

  // ------------------------------------------------------------ source management

  @Patch('sources/:slug')
  @AdminOnly()
  @ApiOperation({ summary: 'Enable/disable a source or change its poll interval' })
  async updateSource(@Param('slug') slug: string, @Body() body: { enabled?: boolean; pollIntervalMinutes?: number }, @CurrentUser() user: User, @Req() req: Request) {
    const source = await this.prisma.digestSource.findUnique({ where: { slug: slug.slice(0, 60) } });
    if (!source) throw new NotFoundException('Source not found');
    const data: { enabled?: boolean; pollIntervalMinutes?: number } = {};
    if (typeof body?.enabled === 'boolean') data.enabled = body.enabled;
    if (body?.pollIntervalMinutes !== undefined) {
      const n = Number(body.pollIntervalMinutes);
      if (!Number.isInteger(n) || n < 5 || n > 1440) throw new BadRequestException('Poll interval must be a whole number of minutes from 5 to 1440');
      data.pollIntervalMinutes = n;
    }
    if (!Object.keys(data).length) throw new BadRequestException('Nothing to change');
    await this.prisma.digestSource.update({ where: { slug: source.slug }, data });
    this.config.invalidateFeedHosts();
    const a = this.actor(user, req);
    await this.audit.log({ actorId: a.id, action: 'CYBERDIGEST_SOURCE_UPDATED', targetType: 'DIGEST_SOURCE', targetId: source.id, details: { slug: source.slug, from: { enabled: source.enabled, pollIntervalMinutes: source.pollIntervalMinutes }, to: data }, ipAddress: a.ip, userAgent: a.userAgent });
    return { ok: true };
  }

  @Post('sources/:slug/poll')
  @AdminOnly()
  @ApiOperation({ summary: 'Poll one source now' })
  async pollNow(@Param('slug') slug: string, @CurrentUser() user: User, @Req() req: Request) {
    const a = this.actor(user, req);
    await this.audit.log({ actorId: a.id, action: 'CYBERDIGEST_SOURCE_UPDATED', targetType: 'DIGEST_SOURCE', details: { slug: slug.slice(0, 60), manualPoll: true }, ipAddress: a.ip, userAgent: a.userAgent });
    return this.ingestion.pollSource(slug.slice(0, 60));
  }

  // ------------------------------------------------------------------- daily digest

  @Get('digests')
  @ApiOperation({ summary: 'Daily digests (readers: published only, within retention)' })
  async digests(@CurrentUser() user: User) {
    return { items: await this.digest.list(this.isAdmin(user)) };
  }

  @Get('digests/latest')
  @ApiOperation({ summary: 'The newest published digest and how old it is' })
  async latest(@CurrentUser() user: User) {
    return this.digest.latest(this.isAdmin(user));
  }

  @Get('digests/:date')
  async digestByDate(@Param('date') date: string, @CurrentUser() user: User) {
    return this.digest.get(date, this.isAdmin(user));
  }

  @Post('digests/generate')
  @AdminOnly()
  @ApiOperation({ summary: "Optional: build today's digest now, held for review. The scheduled job never needs this." })
  async generateDigest(@CurrentUser() user: User, @Req() req: Request) {
    return this.digest.generate({ actor: this.actor(user, req) });
  }

  @Post('digests/:date/publish')
  @AdminOnly()
  async publishDigest(@Param('date') date: string, @CurrentUser() user: User, @Req() req: Request) {
    return this.digest.publish(date, this.actor(user, req));
  }

  @Post('digests/:date/withdraw')
  @AdminOnly()
  async withdrawDigest(@Param('date') date: string, @Body() body: { reason?: string }, @CurrentUser() user: User, @Req() req: Request) {
    return this.digest.withdraw(date, body?.reason, this.actor(user, req));
  }
}

/** Only the fields a browser may use for a link. */
function pick(l: { href: string | null; host: string | null }) {
  return { url: l.href, urlHost: l.host };
}
function idList(v: unknown): unknown[] {
  return Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && x.length <= 64))].slice(0, BULK_MAX) : [];
}
