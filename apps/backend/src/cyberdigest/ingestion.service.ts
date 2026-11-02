import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SOURCES, ALLOWED_HOSTS } from './sources.config';
import { safeFetch, SafeFetchError } from './safe-fetch';
import { parseFeed, FeedParseError } from './feed-parser';
import { categorize } from './classify';
import { validateSummary } from './summary-guard';
import { UpstreamFormatError } from './cve-clients';
import { KevService } from './kev.service';
import { CveVerificationService } from './cve-verification.service';
import { canonicalUrl, contentHash, dedupKey, extractCveIds, extractiveSummary } from './normalize';

const POLLABLE_TYPES = ['NEWS_RSS', 'RESEARCH_RSS', 'KEV_JSON']; // CVE.org / NVD are looked up per CVE, not polled
const FEED_CONTENT_TYPES = /xml|rss|atom/i;
const MAX_BACKOFF_DOUBLINGS = 4;
const FAILING_AFTER = 3;
const STALE_AFTER_INTERVALS = 3;

export type HealthState = 'DISABLED' | 'UNKNOWN' | 'HEALTHY' | 'STALE' | 'FAILING';

interface HealthInput {
  enabled: boolean;
  pollIntervalMinutes: number;
  lastSuccessAt: Date | null;
  consecutiveFailures: number;
  /** CVE.org / NVD are queried on demand: with nothing to look up there is nothing to be stale about. */
  type?: string;
}

/**
 * Health is derived, never assumed: a source is HEALTHY only if it succeeded recently. The UI must not show "all good"
 * while any enabled source is anything else.
 */
export function computeHealth(s: HealthInput, now = new Date()): HealthState {
  if (!s.enabled) return 'DISABLED';
  if (s.consecutiveFailures >= FAILING_AFTER) return 'FAILING';
  if (!s.lastSuccessAt) return s.consecutiveFailures > 0 ? 'FAILING' : 'UNKNOWN';
  if (s.type === 'CVE_API' || s.type === 'NVD_API') return 'HEALTHY';
  const ageMin =(now.getTime() - s.lastSuccessAt.getTime()) / 60000;
  return ageMin > s.pollIntervalMinutes * STALE_AFTER_INTERVALS ? 'STALE' : 'HEALTHY';
}

/** Minutes to wait before the next attempt: interval, doubling per consecutive failure (bounded). */
export function nextDelayMinutes(intervalMin: number, failures: number): number {
  return intervalMin * 2 ** Math.min(failures, MAX_BACKOFF_DOUBLINGS);
}

export interface PollResult {
  slug: string;
  ok: boolean;
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  error?: string;
}

@Injectable()
export class IngestionService implements OnModuleInit {
  private readonly log = new Logger(IngestionService.name);
  private running = false;
  /** Tests inject a fake network; production uses global fetch. */
  fetchImpl?: typeof fetch;

  constructor(
    private prisma: PrismaService,
    private kev: KevService,
    private cves: CveVerificationService,
  ) {}

  async onModuleInit() {
    try {
      await this.seedSources();
    } catch (e) {
      this.log.error(`Could not seed Cyberdigest sources: ${(e as Error).message}`);
    }
  }

  /** Create missing registry rows; refresh endpoint/metadata from config but never override an admin's enabled/interval. */
  async seedSources() {
    for (const s of SOURCES) {
      await this.prisma.digestSource.upsert({
        where: { slug: s.slug },
        create: { slug: s.slug, name: s.name, type: s.type, endpoint: s.endpoint, website: s.website, trustRole: s.trustRole, enabled: s.enabled, pollIntervalMinutes: s.pollIntervalMinutes },
        update: { name: s.name, type: s.type, endpoint: s.endpoint, website: s.website, trustRole: s.trustRole },
      });
    }
  }

  // ponytail: a 5-minute tick + per-source due check replaces one scheduler job per source; BullMQ queueing if polling ever needs parallelism.
  @Cron('*/5 * * * *')
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.pollDue();
    } catch (e) {
      this.log.error(`Cyberdigest poll tick failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async pollDue(now = new Date()): Promise<PollResult[]> {
    const sources = await this.prisma.digestSource.findMany({ where: { enabled: true, type: { in: POLLABLE_TYPES as any } } });
    const results: PollResult[] = [];
    for (const s of sources) {
      const waitMs = nextDelayMinutes(s.pollIntervalMinutes, s.consecutiveFailures) * 60000;
      if (s.lastAttemptAt && now.getTime() - s.lastAttemptAt.getTime() < waitMs) continue;
      results.push(await this.pollSource(s.slug, now));
    }
    return results;
  }

  async pollSource(slug: string, now = new Date()): Promise<PollResult> {
    const source = await this.prisma.digestSource.findUnique({ where: { slug } });
    const result: PollResult = { slug, ok: false, fetched: 0, created: 0, updated: 0, skipped: 0 };
    if (!source || !POLLABLE_TYPES.includes(source.type)) {
      result.error = 'not a pollable source';
      return result;
    }
    try {
      let res: { etag?: string; lastModified?: string };
      if (source.type === 'KEV_JSON') {
        this.kev.fetchImpl = this.fetchImpl;
        const k = await this.kev.sync(source);
        res = k;
        result.fetched = k.added + k.updated;
        result.created = k.added;
        result.updated = k.updated;
        // Tracked CVEs pick up KEV changes immediately, without a network call.
        if (!k.notModified) await this.cves.reapplyKev();
      } else {
        const feed = await safeFetch(source.endpoint, {
          allowedHosts: ALLOWED_HOSTS,
          contentTypes: FEED_CONTENT_TYPES,
          fetchImpl: this.fetchImpl,
          headers: {
            ...(source.etag ? { 'if-none-match': source.etag } : {}),
            ...(source.lastModified ? { 'if-modified-since': source.lastModified } : {}),
          },
        });
        res = feed;
        if (!feed.notModified) {
          const items = parseFeed(feed.body);
          result.fetched = items.length;
          for (const item of items) {
            const r = await this.storeItem(source, item);
            result[r]++;
          }
        }
      }
      await this.prisma.digestSource.update({
        where: { id: source.id },
        data: { lastAttemptAt: now, lastSuccessAt: now, consecutiveFailures: 0, lastError: null, health: 'HEALTHY', etag: res.etag ?? source.etag, lastModified: res.lastModified ?? source.lastModified },
      });
      result.ok = true;
    } catch (e) {
      const known = e instanceof SafeFetchError || e instanceof FeedParseError || e instanceof UpstreamFormatError;
      const msg = e instanceof SafeFetchError ? `${e.kind}: ${e.message}` : e instanceof FeedParseError ? `parse: ${e.message}` : e instanceof UpstreamFormatError ? `format: ${e.message}` : 'unexpected error';
      if (!known) this.log.error(`Poll ${slug} failed: ${(e as Error).message}`);
      const failures = source.consecutiveFailures + 1;
      await this.prisma.digestSource.update({
        where: { id: source.id },
        data: { lastAttemptAt: now, consecutiveFailures: failures, lastError: msg.slice(0, 300), health: computeHealth({ ...source, consecutiveFailures: failures }, now) as any },
      });
      result.error = msg;
    }
    return result;
  }

  private async storeItem(source: { id: string; slug: string }, item: ReturnType<typeof parseFeed>[number]): Promise<'created' | 'updated' | 'skipped'> {
    const canonical = canonicalUrl(item.url);
    if (!canonical) return 'skipped';
    const hash = contentHash(item.title, item.description);
    const key = dedupKey(source.slug, canonical);

    const existing = await this.prisma.digestStory.findUnique({ where: { dedupKey: key } });
    if (existing && existing.contentHash === hash) return 'skipped';

    // Evidence first: exactly what the source returned, hashed, never edited afterwards.
    const raw = await this.prisma.digestRawItem.upsert({
      where: { sourceId_externalId_contentHash: { sourceId: source.id, externalId: item.externalId, contentHash: hash } },
      create: {
        sourceId: source.id,
        externalId: item.externalId,
        url: item.url,
        contentHash: hash,
        payload: { title: item.title, author: item.author, description: item.description, publishedAt: item.publishedAt?.toISOString() ?? null, updatedAt: item.updatedAt?.toISOString() ?? null },
      },
      update: {},
    });

    // The summary must pass the same post-generation check as any other summary would: it is dropped, not repaired, if it fails.
    const candidate = extractiveSummary(item.description);
    const guard = candidate ? validateSummary(candidate, `${item.title}\n${item.description}`) : { ok: true, unsupported: [] };
    if (!guard.ok) this.log.warn(`Dropped summary for ${canonical}: unsupported ${guard.unsupported.join(', ')}`);
    const fields = {
      title: item.title,
      author: item.author,
      publishedAt: item.publishedAt,
      updatedAtSource: item.updatedAt,
      contentHash: hash,
      summary: guard.ok ? candidate : null,
      cveIds: extractCveIds(item.title, item.description),
      categories: categorize(item.title, item.description, source.slug),
      rawItemId: raw.id,
    };
    if (!existing) {
      await this.prisma.digestStory.create({ data: { ...fields, sourceId: source.id, canonicalUrl: canonical, dedupKey: key } });
      return 'created';
    }
    // The publisher changed the content: whatever was verified before no longer applies.
    await this.prisma.digestStory.update({ where: { id: existing.id }, data: { ...fields, verificationState: 'PENDING', lastVerifiedAt: null, stateNote: null, reviewedById: null, reviewedAt: null } });
    return 'updated';
  }
}
