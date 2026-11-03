import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { categorize } from './classify';
import { Actor } from './zero-day.service';

export type StoryState = 'PENDING' | 'ATTRIBUTED' | 'VERIFIED' | 'CONFLICTING' | 'REJECTED' | 'SOURCE_UNAVAILABLE';

export interface StoryDecision {
  state: StoryState;
  note: string | null;
}

/**
 * Publication state of a story, from facts only.
 *  - Nothing the publisher wrote is ever promoted to "verified" by the system: ATTRIBUTED means "the publisher
 *    reported this", which is all an article can establish on its own.
 *  - A story citing a CVE that CVE.org rejects or does not know is CONFLICTING (the claim is disputed by the authority).
 *  - A story whose CVEs have not been resolved yet is PENDING (not yet attributable as technically sound).
 */
export function decideStoryState(cveIds: string[], cves: Map<string, string>): StoryDecision {
  if (!cveIds.length) return { state: 'ATTRIBUTED', note: null };
  const conflicts = cveIds.filter((id) => ['REJECTED', 'NOT_FOUND'].includes(cves.get(id) ?? ''));
  if (conflicts.length) {
    const detail = conflicts.map((id) => (cves.get(id) === 'REJECTED' ? `${id} is rejected in the CVE record` : `${id} has no public CVE.org record`));
    return { state: 'CONFLICTING', note: `Article cites a CVE that the authoritative record does not support: ${detail.join('; ')}` };
  }
  const unresolved = cveIds.filter((id) => cves.get(id) !== 'PUBLISHED');
  if (unresolved.length) return { state: 'PENDING', note: `Waiting for CVE.org verification of ${unresolved.join(', ')}` };
  return { state: 'ATTRIBUTED', note: null };
}

const MIN_REASON = 5;

@Injectable()
export class StoryReviewService {
  private readonly log = new Logger(StoryReviewService.name);
  private running = false;

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private reason(v: unknown): string {
    const r = typeof v === 'string' ? v.trim() : '';
    if (r.length < MIN_REASON) throw new BadRequestException('A reason is required');
    return r.slice(0, 1000);
  }

  private async cveMap(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.digestCve.findMany({ where: { cveId: { in: ids } }, select: { cveId: true, recordStatus: true } });
    return new Map(rows.map((r) => [r.cveId, r.recordStatus as string]));
  }

  private event(storyId: string, event: string, detail: unknown) {
    return this.prisma.digestEvent.create({ data: { entityType: 'STORY', entityId: storyId, event, detail: detail as any } });
  }

  /** Re-derive states for stories nobody has ruled on. A VERIFIED story whose CVE evidence turns bad is demoted at once. */
  async refresh(now = new Date()): Promise<number> {
    const stories = await this.prisma.digestStory.findMany({ where: { verificationState: { in: ['PENDING', 'ATTRIBUTED', 'CONFLICTING', 'VERIFIED'] } }, orderBy: { ingestedAt: 'desc' }, take: 1000 });
    const cves = await this.cveMap([...new Set(stories.flatMap((s) => s.cveIds))]);
    let changed = 0;
    for (const s of stories) {
      const d = decideStoryState(s.cveIds, cves);
      const before = s.verificationState; // read once: the update below must not change what we compare against
      if (before === 'VERIFIED' && d.state !== 'CONFLICTING') {
        // Analyst-approved and the evidence still holds: leave it, just note it was rechecked.
        await this.prisma.digestStory.update({ where: { id: s.id }, data: { lastVerifiedAt: now } });
        continue;
      }
      const fillCategories = !s.categories?.length; // stories ingested before categories existed
      const keepCorrectionNote = d.state === before && !!s.stateNote?.startsWith('Corrected:'); // the analyst's explanation stays visible
      if (d.state === before && (d.note === (s.stateNote ?? null) || keepCorrectionNote) && !fillCategories) {
        continue;
      }
      await this.prisma.digestStory.update({
        where: { id: s.id },
        data: {
          verificationState: d.state,
          stateNote: d.note,
          lastVerifiedAt: now,
          ...(before === 'VERIFIED' && { reviewedById: null, reviewedAt: null }), // approval does not survive a conflict
          ...(fillCategories && { categories: categorize(s.title, s.summary ?? '', '') }),
        },
      });
      if (d.state !== before) {
        await this.event(s.id, 'STATE_CHANGED', { from: before, to: d.state, note: d.note, by: 'system' });
        changed++;
      }
    }
    return changed;
  }

  // ponytail: full pass over the latest 1000 stories every 10 minutes; incremental by CVE change if volume grows.
  @Cron('*/10 * * * *')
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.refresh();
    } catch (e) {
      this.log.error(`Story review pass failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async get(id: string) {
    const s = await this.prisma.digestStory.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Story not found');
    return s;
  }

  /** Writes a decision only if the story is still in the state the decision was based on; the database decides, atomically. */
  private async decide(id: string, expected: string, data: Record<string, unknown>) {
    const r = await this.prisma.digestStory.updateMany({ where: { id, verificationState: expected as any }, data: data as any });
    if (r.count === 0) throw new ConflictException('The story changed while you were reviewing it. Reload and check it again.');
  }

  /** Analyst confirms the article's claims against primary sources. Only possible when every cited CVE is confirmed. */
  async approve(id: string, reason: unknown, actor: Actor) {
    const why = this.reason(reason);
    const s = await this.get(id);
    if (s.verificationState === 'REJECTED') throw new ConflictException('Correct the rejection before approving');
    const d = decideStoryState(s.cveIds, await this.cveMap(s.cveIds));
    if (d.state !== 'ATTRIBUTED') throw new ConflictException(d.note ?? 'The story is not ready to be verified');
    await this.decide(id, s.verificationState, { verificationState: 'VERIFIED', stateNote: why, reviewedById: actor.id, reviewedAt: new Date(), lastVerifiedAt: new Date() });
    await this.event(id, 'APPROVED', { by: actor.id, reason: why });
    await this.audit.log({ actorId: actor.id, action: 'CYBERDIGEST_STORY_APPROVED', targetType: 'DIGEST_STORY', targetId: id, details: { reason: why, url: s.canonicalUrl }, ipAddress: actor.ip, userAgent: actor.userAgent });
  }

  async reject(id: string, reason: unknown, actor: Actor) {
    const why = this.reason(reason);
    const s = await this.get(id);
    await this.decide(id, s.verificationState, { verificationState: 'REJECTED', stateNote: why, reviewedById: actor.id, reviewedAt: new Date() });
    await this.event(id, 'REJECTED', { from: s.verificationState, by: actor.id, reason: why });
    await this.audit.log({ actorId: actor.id, action: 'CYBERDIGEST_STORY_REJECTED', targetType: 'DIGEST_STORY', targetId: id, details: { reason: why, url: s.canonicalUrl }, ipAddress: actor.ip, userAgent: actor.userAgent });
  }

  /** Undo an approval or rejection. The story goes back to the state the evidence supports, with the correction on record. */
  async correct(id: string, reason: unknown, actor: Actor) {
    const why = this.reason(reason);
    const s = await this.get(id);
    if (s.verificationState !== 'VERIFIED' && s.verificationState !== 'REJECTED') throw new ConflictException('Only an approved or rejected story can be corrected');
    const d = decideStoryState(s.cveIds, await this.cveMap(s.cveIds));
    await this.decide(id, s.verificationState, { verificationState: d.state, stateNote: `Corrected: ${why}`, reviewedById: actor.id, reviewedAt: new Date(), lastVerifiedAt: new Date() });
    await this.event(id, 'CORRECTED', { from: s.verificationState, to: d.state, by: actor.id, reason: why });
    await this.audit.log({ actorId: actor.id, action: 'CYBERDIGEST_STORY_CORRECTED', targetType: 'DIGEST_STORY', targetId: id, details: { from: s.verificationState, to: d.state, reason: why }, ipAddress: actor.ip, userAgent: actor.userAgent });
  }
}
