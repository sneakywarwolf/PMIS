import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { ALLOWED_HOSTS, DEFAULT_LINK_HOSTS } from './sources.config';
import { Actor } from './zero-day.service';
import { normalizeHostname, parsePublicHttpsUrl, REDIRECTOR_HOSTS, validateAllowlistHost } from './url-policy';

export interface DigestConfigValues {
  moduleEnabledForNonAdmins: boolean;
  pipelineEnabled: boolean;
  publishTime: string;
  timezone: string;
  publishMode: 'AUTO' | 'HOLD';
  minDiscoveryCoveragePct: number;
  retentionDays: number;
  jobRetryBackoffMinutes: number;
  linkHosts: string[];
}

export const EDITABLE_FIELDS = ['moduleEnabledForNonAdmins', 'pipelineEnabled', 'publishTime', 'timezone', 'minDiscoveryCoveragePct', 'retentionDays', 'jobRetryBackoffMinutes'] as const;

export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Returns an error message, or null. Each field is checked server-side regardless of what the screen allowed. */
export function validateConfigPatch(patch: Record<string, unknown>): string | null {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return 'Body must be an object';
  for (const [k, v] of Object.entries(patch)) {
    if (!(EDITABLE_FIELDS as readonly string[]).includes(k)) return `Unknown or read-only setting: ${k}`;
    if ((k === 'moduleEnabledForNonAdmins' || k === 'pipelineEnabled') && typeof v !== 'boolean') return `${k} must be true or false`;
    if (k === 'publishTime' && !(typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v))) return 'publishTime must be HH:MM (24-hour)';
    if (k === 'timezone' && !isValidTimezone(v)) return 'timezone must be a valid IANA time zone such as Asia/Kolkata';
    if (k === 'minDiscoveryCoveragePct' && !(Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100)) return 'minDiscoveryCoveragePct must be a whole number from 0 to 100';
    if (k === 'retentionDays' && !(Number.isInteger(v) && (v as number) >= 30 && (v as number) <= 3650)) return 'retentionDays must be a whole number from 30 to 3650';
    if (k === 'jobRetryBackoffMinutes' && !(Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 120)) return 'jobRetryBackoffMinutes must be a whole number from 1 to 120';
  }
  return null;
}

/** First-run defaults. Environment variables only seed the row; after that the administrator's settings are the truth. */
function seedFromEnv(): Partial<DigestConfigValues> {
  const t = process.env.CYBERDIGEST_DIGEST_TIME;
  const mode = (process.env.CYBERDIGEST_DIGEST_MODE ?? '').toLowerCase();
  return { publishTime: t && /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : '08:00', publishMode: mode === 'hold' || mode === 'shadow' ? 'HOLD' : 'AUTO' };
}

const FEED_HOST_CACHE_MS = 15_000;

@Injectable()
export class DigestConfigService {
  private feedHostCache: { at: number; hosts: Set<string> } | null = null;

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /** Read from the database every time: access changes must apply to the very next request, on every instance. */
  async get(): Promise<DigestConfigValues & { updatedAt: Date | null; updatedById: string | null }> {
    let row = await this.prisma.digestConfig.findUnique({ where: { id: 'singleton' } });
    if (!row) {
      try {
        row = await this.prisma.digestConfig.create({ data: { id: 'singleton', ...seedFromEnv(), linkHosts: [...DEFAULT_LINK_HOSTS] } });
      } catch {
        row = await this.prisma.digestConfig.findUnique({ where: { id: 'singleton' } }); // another instance created it first
      }
    }
    if (!row) throw new Error('Cyberdigest configuration is unavailable');
    return {
      moduleEnabledForNonAdmins: row.moduleEnabledForNonAdmins, pipelineEnabled: row.pipelineEnabled, publishTime: row.publishTime, timezone: row.timezone,
      publishMode: row.publishMode === 'HOLD' ? 'HOLD' : 'AUTO', minDiscoveryCoveragePct: row.minDiscoveryCoveragePct, retentionDays: row.retentionDays,
      jobRetryBackoffMinutes: row.jobRetryBackoffMinutes, linkHosts: row.linkHosts, updatedAt: row.updatedAt, updatedById: row.updatedById,
    };
  }

  async moduleEnabledForNonAdmins(): Promise<boolean> {
    return (await this.get()).moduleEnabledForNonAdmins;
  }
  async pipelineEnabled(): Promise<boolean> {
    return (await this.get()).pipelineEnabled;
  }

  /** Hosts a link may point to: exactly the administrator-managed list (exact names only). */
  async linkHostSet(): Promise<Set<string>> {
    return new Set((await this.get()).linkHosts);
  }

  async update(patch: Record<string, unknown>, actor: Actor) {
    const err = validateConfigPatch(patch);
    if (err) throw new BadRequestException(err);
    const before = await this.get();
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [k, v] of Object.entries(patch)) if ((before as any)[k] !== v) changes[k] = { from: (before as any)[k], to: v };
    if (!Object.keys(changes).length) return before;
    await this.prisma.digestConfig.update({ where: { id: 'singleton' }, data: { ...(patch as object), updatedById: actor.id } });
    await this.audit.log({ actorId: actor.id, action: 'CYBERDIGEST_CONFIG_UPDATED', targetType: 'DIGEST_CONFIG', targetId: 'singleton', details: { changes }, ipAddress: actor.ip, userAgent: actor.userAgent });
    return this.get();
  }

  // ----------------------------------------------------------------------------- link allowlist

  async addLinkHost(raw: unknown, actor: Actor): Promise<string[]> {
    const v = validateAllowlistHost(raw);
    if (!v.ok) throw new BadRequestException(v.error);
    const cur = await this.get();
    if (cur.linkHosts.includes(v.host)) throw new ConflictException('That hostname is already allowed');
    if (cur.linkHosts.length >= 200) throw new BadRequestException('The allowlist is full');
    const next = [...cur.linkHosts, v.host].sort();
    await this.prisma.digestConfig.update({ where: { id: 'singleton' }, data: { linkHosts: next, updatedById: actor.id } });
    await this.audit.log({ actorId: actor.id, action: 'CYBERDIGEST_ALLOWLIST_CHANGED', targetType: 'DIGEST_CONFIG', targetId: 'singleton', details: { added: v.host }, ipAddress: actor.ip, userAgent: actor.userAgent });
    return next;
  }

  async removeLinkHost(raw: unknown, actor: Actor): Promise<string[]> {
    const host = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    const cur = await this.get();
    if (!cur.linkHosts.includes(host)) throw new NotFoundException('That hostname is not on the list');
    const next = cur.linkHosts.filter((h) => h !== host);
    await this.prisma.digestConfig.update({ where: { id: 'singleton' }, data: { linkHosts: next, updatedById: actor.id } });
    await this.audit.log({ actorId: actor.id, action: 'CYBERDIGEST_ALLOWLIST_CHANGED', targetType: 'DIGEST_CONFIG', targetId: 'singleton', details: { removed: host }, ipAddress: actor.ip, userAgent: actor.userAgent });
    return next;
  }

  // ------------------------------------------------------------------------------ feed hosts

  /** Hosts the server may fetch from: the built-in authoritative/feed hosts plus the endpoints of enabled, administrator-added sources. */
  async feedHostSet(): Promise<Set<string>> {
    if (this.feedHostCache && Date.now() - this.feedHostCache.at < FEED_HOST_CACHE_MS) return this.feedHostCache.hosts;
    const hosts = new Set(ALLOWED_HOSTS);
    const sources = await this.prisma.digestSource.findMany({ where: { enabled: true }, select: { endpoint: true } });
    for (const s of sources) {
      const p = parsePublicHttpsUrl(s.endpoint);
      if (p.ok) hosts.add(p.value.host);
    }
    this.feedHostCache = { at: Date.now(), hosts };
    return hosts;
  }
  invalidateFeedHosts() {
    this.feedHostCache = null;
  }

  /**
   * Adds a news/research feed. The one administrator action covers both lists: the server may fetch the feed's host, and
   * users may click through to the site's host. Every fetch is still checked against the resolved IP at connect time.
   */
  async addSource(input: { name?: unknown; endpoint?: unknown; website?: unknown }, actor: Actor) {
    const name = typeof input?.name === 'string' ? input.name.trim().slice(0, 80) : '';
    if (name.length < 3) throw new BadRequestException('A source name of at least 3 characters is required');
    const feed = parsePublicHttpsUrl(input?.endpoint);
    if (!feed.ok) throw new BadRequestException(`Feed URL refused (${feed.reason}). It must be a public https address with a hostname.`);
    const site = parsePublicHttpsUrl(input?.website ?? `https://${feed.value.host}/`);
    if (!site.ok) throw new BadRequestException(`Website URL refused (${site.reason})`);
    if (REDIRECTOR_HOSTS.has(feed.value.host)) throw new BadRequestException('Link shorteners and redirectors cannot be sources');
    const slug = `custom-${feed.value.host.replace(/[^a-z0-9]+/g, '-')}-${Math.abs(hash(feed.value.href)).toString(36)}`.slice(0, 60);
    if (await this.prisma.digestSource.findUnique({ where: { slug } })) throw new ConflictException('That feed is already a source');
    if ((await this.prisma.digestSource.count()) >= 60) throw new BadRequestException('Too many sources');
    const row = await this.prisma.digestSource.create({ data: { slug, name, type: 'NEWS_RSS', endpoint: feed.value.href, website: site.value.href, trustRole: 'DISCOVERY', enabled: true, pollIntervalMinutes: 30 } });
    const cur = await this.get();
    const linkAdd = [site.value.host].filter((h) => !cur.linkHosts.includes(h) && normalizeHostname(h));
    if (linkAdd.length) await this.prisma.digestConfig.update({ where: { id: 'singleton' }, data: { linkHosts: [...cur.linkHosts, ...linkAdd].sort(), updatedById: actor.id } });
    this.invalidateFeedHosts();
    await this.audit.log({ actorId: actor.id, action: 'CYBERDIGEST_SOURCE_ADDED', targetType: 'DIGEST_SOURCE', targetId: row.id, details: { slug, name, feed: feed.value.href, website: site.value.href, linkHostsAdded: linkAdd }, ipAddress: actor.ip, userAgent: actor.userAgent });
    return row;
  }
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
