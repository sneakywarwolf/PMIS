import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { isValidCveId } from './cve-clients';
import { canonicalUrl } from './normalize';
import { EVIDENCE_KINDS, evaluate, EvidenceItem, Evaluation, MANUAL_TARGETS, SOURCE_TYPES, ZeroDayState } from './zero-day.engine';

export interface Actor {
  id: string;
  ip: string;
  userAgent: string;
}

export interface EvidenceInput {
  kind: string;
  sourceType: string;
  sourceName: string;
  url: string;
  eventDate?: string | null;
  note?: string | null;
}

const KEV_PAGE = 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog';
const ZERO_DAY_WORDS = /\b(zero[\s-]?day|0[\s-]?day)\b/i;
const MAX_CVES_PER_CLAIM = 3; // a story naming many CVEs does not say which one is the zero-day
const MIN_REASON = 5;
const MAX_EVIDENCE_PER_CASE = 100;
const RESERVED_SOURCE_NAMES = new Set(['cisa kev', 'cisa known exploited vulnerabilities', 'kev', 'cisa kev catalog']);

const toItem = (e: any): EvidenceItem => ({ id: e.id, kind: e.kind, sourceType: e.sourceType, sourceName: e.sourceName, url: e.url, eventDate: e.eventDate ?? null, retracted: !!e.retractedAt });

@Injectable()
export class ZeroDayService {
  private readonly log = new Logger(ZeroDayService.name);
  private running = false;

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- helpers

  private async event(cveId: string, event: string, detail: unknown) {
    await this.prisma.digestEvent.create({ data: { entityType: 'ZERODAY', entityId: cveId, event, detail: detail as any } });
  }

  private async load(cveId: string) {
    const c = await this.prisma.digestZeroDayCase.findUnique({ where: { cveId }, include: { evidence: true } });
    const cve = await this.prisma.digestCve.findUnique({ where: { cveId } });
    return { c, cve };
  }

  private evaluateCase(c: { evidence: any[] }, cve: { recordStatus: string } | null): Evaluation {
    return evaluate(c.evidence.map(toItem), { cvePublished: cve?.recordStatus === 'PUBLISHED' });
  }

  private snapshot(ev: Evaluation, analystReason?: string) {
    return { reasons: ev.reasons, missing: ev.missing, conflicts: ev.conflicts, basis: ev.basis, ...(analystReason && { analystReason }) };
  }

  private normId(raw: string): string {
    const id = String(raw ?? '').trim().toUpperCase();
    if (!isValidCveId(id)) throw new BadRequestException('Malformed CVE id');
    return id;
  }

  private cleanReason(reason: unknown): string {
    const r = typeof reason === 'string' ? reason.trim() : '';
    if (r.length < MIN_REASON) throw new BadRequestException('A reason is required');
    return r.slice(0, 1000);
  }

  async ensureCase(cveId: string) {
    const found = await this.prisma.digestZeroDayCase.findUnique({ where: { cveId } });
    if (found) return found;
    try {
      const created = await this.prisma.digestZeroDayCase.create({ data: { cveId, state: 'UNKNOWN', stateReasons: { reasons: ['Case opened; no evidence recorded yet'], missing: [], conflicts: [], basis: [] } } });
      await this.event(cveId, 'CASE_OPENED', {});
      return created;
    } catch (e: any) {
      // The scheduled sync and an analyst can open the same case at the same moment: the loser just uses the winner's row.
      if (e?.code === 'P2002') {
        const again = await this.prisma.digestZeroDayCase.findUnique({ where: { cveId } });
        if (again) return again;
      }
      throw e;
    }
  }

  /** Writes an analyst decision only if the case is still in the state it was judged in; the database decides, atomically. */
  private async decide(cveId: string, expected: string, data: Record<string, unknown>) {
    const r = await this.prisma.digestZeroDayCase.updateMany({ where: { cveId, state: expected as any }, data: data as any });
    if (r.count === 0) throw new ConflictException('The case changed while you were reviewing it. Reload and check it again.');
  }

  // ------------------------------------------------------- state recompute

  /**
   * Re-derives the case from its evidence. A case an analyst placed is left where they put it, with one exception that
   * is deliberately one-way: a CONFIRMED case whose evidence no longer qualifies is demoted at once (fail closed).
   */
  async recompute(cveId: string): Promise<void> {
    const { c, cve } = await this.load(cveId);
    if (!c) return;
    const ev = this.evaluateCase(c, cve);
    const now = new Date();
    if (c.state === 'CONFIRMED') {
      if (ev.eligible) {
        await this.prisma.digestZeroDayCase.update({ where: { cveId }, data: { stateReasons: this.snapshot(ev) as any } });
        return;
      }
      await this.prisma.digestZeroDayCase.update({ where: { cveId }, data: { state: ev.suggested, stateReasons: this.snapshot(ev) as any, stateSetById: null, stateSetAt: now, approvedById: null, approvedAt: null } });
      await this.event(cveId, 'AUTO_DEMOTED', { from: 'CONFIRMED', to: ev.suggested, reasons: ev.reasons, missing: ev.missing, conflicts: ev.conflicts });
      return;
    }
    const analystPlaced = c.stateSetById !== null;
    const next: ZeroDayState = analystPlaced ? (c.state as ZeroDayState) : ev.suggested;
    const prev = (c.stateReasons ?? {}) as any;
    const snap = this.snapshot(ev, analystPlaced ? prev.analystReason : undefined);
    if (next !== c.state) {
      await this.prisma.digestZeroDayCase.update({ where: { cveId }, data: { state: next, stateReasons: snap as any, stateSetAt: now } });
      await this.event(cveId, 'STATE_CHANGED', { from: c.state, to: next, by: 'system', reasons: ev.reasons });
    } else if (JSON.stringify(prev) !== JSON.stringify(snap)) {
      await this.prisma.digestZeroDayCase.update({ where: { cveId }, data: { stateReasons: snap as any } });
    }
  }

  // --------------------------------------------------------------- evidence

  async addEvidence(rawCve: string, input: EvidenceInput, actor: Actor) {
    const cveId = this.normId(rawCve);
    if (!(EVIDENCE_KINDS as readonly string[]).includes(input?.kind)) throw new BadRequestException('Unknown evidence kind');
    if (!(SOURCE_TYPES as readonly string[]).includes(input?.sourceType)) throw new BadRequestException('Unknown source type');
    const sourceName = String(input.sourceName ?? '').trim().slice(0, 200);
    if (!sourceName) throw new BadRequestException('The source name is required');
    // The system's own evidence is labelled with these names; a person must not be able to pass off an entry as one of them.
    if (RESERVED_SOURCE_NAMES.has(sourceName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())) throw new BadRequestException('That source name is reserved for automatic evidence');
    const url = canonicalUrl(String(input.url ?? ''));
    if (!url) throw new BadRequestException('The evidence URL must be an http(s) link');
    let eventDate: Date | null = null;
    if (input.eventDate) {
      const t = Date.parse(input.eventDate);
      if (!Number.isFinite(t)) throw new BadRequestException('Invalid event date');
      if (t > Date.now() + 86_400_000) throw new BadRequestException('The event date cannot be in the future');
      eventDate = new Date(t);
    }
    const note = input.note ? String(input.note).slice(0, 1000) : null;

    const c = await this.ensureCase(cveId);
    const existing = await this.prisma.digestZeroDayEvidence.count({ where: { caseId: c.id } });
    if (existing >= MAX_EVIDENCE_PER_CASE) throw new BadRequestException('This case already holds the maximum amount of evidence');
    const row = await this.prisma.digestZeroDayEvidence.create({ data: { caseId: c.id, kind: input.kind, sourceType: input.sourceType, sourceName, url, eventDate, note, addedById: actor.id } });
    await this.event(cveId, 'EVIDENCE_ADDED', { evidenceId: row.id, kind: row.kind, sourceType: row.sourceType, url, eventDate, by: actor.id });
    await this.audit.log({ actorId: actor.id, action: 'CYBERDIGEST_EVIDENCE_ADDED', targetType: 'ZERODAY_CASE', targetId: c.id, details: { cveId, evidenceId: row.id, kind: row.kind, url }, ipAddress: actor.ip, userAgent: actor.userAgent });
    await this.recompute(cveId);
    return row;
  }

  async retractEvidence(evidenceId: string, reason: unknown, actor: Actor) {
    const why = this.cleanReason(reason);
    const e = await this.prisma.digestZeroDayEvidence.findUnique({ where: { id: evidenceId }, include: { case: true } });
    if (!e) throw new NotFoundException('Evidence not found');
    if (e.retractedAt) throw new ConflictException('Evidence is already retracted');
    await this.prisma.digestZeroDayEvidence.update({ where: { id: evidenceId }, data: { retractedAt: new Date(), retractedById: actor.id, retractReason: why } });
    await this.event(e.case.cveId, 'EVIDENCE_RETRACTED', { evidenceId, reason: why, by: actor.id });
    await this.audit.log({ actorId: actor.id, action: 'CYBERDIGEST_EVIDENCE_RETRACTED', targetType: 'ZERODAY_CASE', targetId: e.caseId, details: { cveId: e.case.cveId, evidenceId, reason: why }, ipAddress: actor.ip, userAgent: actor.userAgent });
    await this.recompute(e.case.cveId); // may demote a CONFIRMED case straight away
  }

  // ------------------------------------------------------ analyst decisions

  async transition(rawCve: string, target: string, reason: unknown, actor: Actor) {
    const cveId = this.normId(rawCve);
    const why = this.cleanReason(reason);
    if (!MANUAL_TARGETS.includes(target as ZeroDayState)) throw new BadRequestException('A case can only become CONFIRMED through approval');
    const { c, cve } = await this.load(cveId);
    if (!c) throw new NotFoundException('No zero-day case for this CVE');
    if (c.state === 'CONFIRMED') throw new ConflictException('Withdraw the confirmation before changing the state');
    const ev = this.evaluateCase(c, cve);
    if (target === 'KNOWN_EXPLOITED_UNCONFIRMED' && !ev.exploitationEstablished) throw new ConflictException('Exploitation is not established by any primary evidence');
    await this.decide(cveId, c.state, { state: target as any, stateSetById: actor.id, stateSetAt: new Date(), stateReasons: this.snapshot(ev, why) as any });
    await this.event(cveId, 'STATE_CHANGED', { from: c.state, to: target, by: actor.id, reason: why });
    await this.audit.log({ actorId: actor.id, action: 'CYBERDIGEST_ZERODAY_TRANSITION', targetType: 'ZERODAY_CASE', targetId: c.id, details: { cveId, from: c.state, to: target, reason: why }, ipAddress: actor.ip, userAgent: actor.userAgent });
  }

  async approve(rawCve: string, actor: Actor) {
    const cveId = this.normId(rawCve);
    const { c, cve } = await this.load(cveId);
    if (!c) throw new NotFoundException('No zero-day case for this CVE');
    if (c.state === 'CONFIRMED') throw new ConflictException('Already confirmed');
    const ev = this.evaluateCase(c, cve);
    if (!ev.eligible) throw new ConflictException({ message: 'The evidence does not meet the rules for a confirmed zero-day', missing: ev.missing, conflicts: ev.conflicts, reasons: ev.reasons });
    // Optional second-person rule: whoever recorded the evidence the decision rests on cannot also approve it.
    if (process.env.CYBERDIGEST_REQUIRE_SECOND_APPROVER === '1') {
      const own = c.evidence.filter((e: any) => ev.basis.includes(e.id) && e.addedById === actor.id);
      if (own.length) throw new ForbiddenException('A second analyst must approve: you recorded evidence this confirmation rests on');
    }
    const now = new Date();
    await this.decide(cveId, c.state, { state: 'CONFIRMED', approvedById: actor.id, approvedAt: now, stateSetById: actor.id, stateSetAt: now, stateReasons: this.snapshot(ev) as any });
    await this.event(cveId, 'APPROVED', { by: actor.id, basis: ev.basis });
    // Evidence may have been retracted between the check above and the write: re-derive so a stale approval cannot stand.
    await this.recompute(cveId);
    await this.audit.log({ actorId: actor.id, action: 'CYBERDIGEST_ZERODAY_APPROVED', targetType: 'ZERODAY_CASE', targetId: c.id, details: { cveId, basis: ev.basis }, ipAddress: actor.ip, userAgent: actor.userAgent });
  }

  async withdraw(rawCve: string, target: string, reason: unknown, actor: Actor) {
    const cveId = this.normId(rawCve);
    const why = this.cleanReason(reason);
    if (!MANUAL_TARGETS.includes(target as ZeroDayState)) throw new BadRequestException('Invalid target state');
    const { c, cve } = await this.load(cveId);
    if (!c) throw new NotFoundException('No zero-day case for this CVE');
    if (c.state !== 'CONFIRMED') throw new ConflictException('Only a confirmed case can be withdrawn');
    const ev = this.evaluateCase(c, cve);
    await this.decide(cveId, 'CONFIRMED', { state: target as any, approvedById: null, approvedAt: null, stateSetById: actor.id, stateSetAt: new Date(), stateReasons: this.snapshot(ev, why) as any });
    await this.event(cveId, 'WITHDRAWN', { to: target, by: actor.id, reason: why });
    await this.audit.log({ actorId: actor.id, action: 'CYBERDIGEST_ZERODAY_WITHDRAWN', targetType: 'ZERODAY_CASE', targetId: c.id, details: { cveId, to: target, reason: why }, ipAddress: actor.ip, userAgent: actor.userAgent });
  }

  // ----------------------------------------------------------------- queries

  private async names(ids: (string | null)[]): Promise<Map<string, string>> {
    const want = [...new Set(ids.filter((x): x is string => !!x))];
    if (!want.length) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: want } }, select: { id: true, username: true } });
    return new Map(users.map((u) => [u.id, u.username]));
  }

  async view(cveId: string) {
    const { c, cve } = await this.load(cveId);
    if (!c) throw new NotFoundException('No zero-day case for this CVE');
    return this.toView(c, cve, await this.names([c.approvedById, c.stateSetById, ...c.evidence.map((e: any) => e.addedById)]));
  }

  private toView(c: any, cve: any, names: Map<string, string>) {
    const ev = this.evaluateCase(c, cve);
    const confirmed = c.state === 'CONFIRMED' && !!c.approvedById && !!c.approvedAt && ev.eligible; // all three, or it is not shown as confirmed
    return {
      cveId: c.cveId,
      state: c.state,
      publishedAsConfirmed: confirmed,
      eligibleForConfirmation: ev.eligible && c.state !== 'CONFIRMED',
      reasons: ev.reasons,
      missing: ev.missing,
      conflicts: ev.conflicts,
      analystReason: (c.stateReasons as any)?.analystReason ?? null,
      stateSetBy: c.stateSetById ? names.get(c.stateSetById) ?? 'unknown user' : 'system rules',
      stateSetAt: c.stateSetAt,
      approvedBy: c.approvedById ? names.get(c.approvedById) ?? 'unknown user' : null,
      approvedAt: c.approvedAt,
      cve: cve ? { recordStatus: cve.recordStatus, description: cve.description, kevListed: cve.kevListed, kevDateAdded: cve.kevDateAdded, lastVerifiedAt: cve.lastVerifiedAt } : null,
      evidence: [...c.evidence].sort((a: any, b: any) => +new Date(a.createdAt) - +new Date(b.createdAt)).map((e: any) => ({
        id: e.id, kind: e.kind, sourceType: e.sourceType, primary: !['NEWS', 'SOCIAL', 'OTHER'].includes(e.sourceType), sourceName: e.sourceName, url: e.url, eventDate: e.eventDate, note: e.note,
        addedBy: e.addedById ? names.get(e.addedById) ?? 'unknown user' : 'system', createdAt: e.createdAt, retracted: !!e.retractedAt, retractReason: e.retractReason ?? null,
      })),
    };
  }

  async list(section: 'confirmed' | 'known_exploited' | 'review') {
    const where = section === 'confirmed' ? { state: 'CONFIRMED' as const, NOT: { approvedAt: null } } : section === 'known_exploited' ? { state: 'KNOWN_EXPLOITED_UNCONFIRMED' as const } : { state: { in: ['REPORTED_UNVERIFIED', 'NOT_SUBSTANTIATED', 'UNKNOWN'] as any } };
    const cases = await this.prisma.digestZeroDayCase.findMany({ where: where as any, include: { evidence: true }, orderBy: { updatedAt: 'desc' }, take: 100 });
    const cves = await this.prisma.digestCve.findMany({ where: { cveId: { in: cases.map((c) => c.cveId) } } });
    const byId = new Map(cves.map((x) => [x.cveId, x]));
    const names = await this.names(cases.flatMap((c) => [c.approvedById, c.stateSetById, ...c.evidence.map((e: any) => e.addedById)]));
    const views = cases.map((c) => this.toView(c, byId.get(c.cveId) ?? null, names));
    return section === 'confirmed' ? views.filter((v) => v.publishedAsConfirmed) : views;
  }

  // -------------------------------------------------------------- scheduled

  /** Every CVE CISA lists as exploited gets a case with KEV recorded as exploitation evidence (undated: KEV says nothing about when). */
  async syncKevCases(): Promise<number> {
    const kevCves = await this.prisma.digestCve.findMany({ where: { kevListed: true }, select: { cveId: true } });
    let n = 0;
    for (const { cveId } of kevCves) {
      const c = await this.ensureCase(cveId);
      const has = await this.prisma.digestZeroDayEvidence.findFirst({ where: { caseId: c.id, sourceName: 'CISA KEV', addedById: null, retractedAt: null } }); // only the system's own row counts
      if (has) continue;
      await this.prisma.digestZeroDayEvidence.create({ data: { caseId: c.id, kind: 'EXPLOITATION_OBSERVED', sourceType: 'GOVERNMENT', sourceName: 'CISA KEV', url: KEV_PAGE, eventDate: null, note: 'Listed in the CISA Known Exploited Vulnerabilities catalog. The catalog does not say when exploitation began.', addedById: null } });
      await this.event(cveId, 'EVIDENCE_ADDED', { kind: 'EXPLOITATION_OBSERVED', source: 'CISA KEV', by: 'system' });
      n++;
    }
    return n;
  }

  /** A publisher saying "zero-day" next to a CVE opens a REPORTED case. It is a claim, and it counts as nothing else. */
  async syncStoryClaims(): Promise<number> {
    const stories = await this.prisma.digestStory.findMany({ where: { NOT: { cveIds: { isEmpty: true } } }, include: { source: { select: { name: true } } }, orderBy: { ingestedAt: 'desc' }, take: 300 });
    let n = 0;
    for (const s of stories) {
      if (!ZERO_DAY_WORDS.test(`${s.title} ${s.summary ?? ''}`) || s.cveIds.length > MAX_CVES_PER_CLAIM) continue;
      for (const cveId of s.cveIds.filter(isValidCveId)) {
        const c = await this.ensureCase(cveId);
        const has = await this.prisma.digestZeroDayEvidence.findFirst({ where: { caseId: c.id, url: s.canonicalUrl, kind: 'ZERO_DAY_CLAIM', addedById: null, retractedAt: null } });
        if (has) continue;
        await this.prisma.digestZeroDayEvidence.create({ data: { caseId: c.id, kind: 'ZERO_DAY_CLAIM', sourceType: 'NEWS', sourceName: s.source.name, url: s.canonicalUrl, eventDate: s.publishedAt ?? null, note: 'Article uses the term zero-day and names this CVE. Reported, not verified.', addedById: null } });
        await this.event(cveId, 'EVIDENCE_ADDED', { kind: 'ZERO_DAY_CLAIM', source: s.source.name, by: 'system' });
        n++;
      }
    }
    return n;
  }

  /** Re-evaluate every open case: unresolved ones are rechecked, and confirmed ones are demoted if their evidence stops qualifying. */
  async recomputeAll(): Promise<number> {
    const cases = await this.prisma.digestZeroDayCase.findMany({ select: { cveId: true } });
    for (const { cveId } of cases) await this.recompute(cveId);
    return cases.length;
  }

  // ponytail: one 10-minute pass over all cases; per-case scheduling if the case count ever makes this slow.
  @Cron('*/10 * * * *')
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.syncKevCases();
      await this.syncStoryClaims();
      await this.recomputeAll();
    } catch (e) {
      this.log.error(`Zero-day sync failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
