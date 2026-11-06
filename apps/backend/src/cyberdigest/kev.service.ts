import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ALLOWED_HOSTS } from './sources.config';
import { isValidCveId, UpstreamFormatError } from './cve-clients';
import { safeFetch } from './safe-fetch';

/**
 * CISA Known Exploited Vulnerabilities catalog. KEV inclusion means CISA has evidence of exploitation; it says nothing
 * about when exploitation began, so it can never by itself make something a zero-day. Absence from the catalog does not
 * prove a CVE is not exploited.
 */
export interface KevRow {
  cveId: string;
  vendorProject: string;
  product: string;
  name: string;
  dateAdded: Date;
  dueDate: Date | null;
  ransomwareUse: string;
  shortDescription: string;
  notes: string | null;
}

export interface ParsedKev {
  catalogVersion: string;
  rows: KevRow[];
}

const toDate = (v: unknown): Date | null => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? new Date(t) : null;
};

/** Strict: a truncated or odd response must fail the sync, never replace good data with partial data. */
export function parseKev(raw: any): ParsedKev {
  if (!raw || typeof raw.catalogVersion !== 'string' || !Array.isArray(raw.vulnerabilities)) throw new UpstreamFormatError('Unexpected KEV catalog shape');
  if (raw.vulnerabilities.length === 0) throw new UpstreamFormatError('KEV catalog is empty');
  if (typeof raw.count === 'number' && raw.count !== raw.vulnerabilities.length) throw new UpstreamFormatError('KEV count does not match entries (truncated?)');
  const seen = new Set<string>();
  const rows: KevRow[] = [];
  for (const v of raw.vulnerabilities) {
    const id = typeof v?.cveID === 'string' ? v.cveID.trim().toUpperCase() : '';
    const dateAdded = toDate(v?.dateAdded);
    if (!isValidCveId(id) || !dateAdded || typeof v.vendorProject !== 'string' || typeof v.product !== 'string') throw new UpstreamFormatError('Malformed KEV entry');
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push({
      cveId: id,
      vendorProject: v.vendorProject,
      product: v.product,
      name: String(v.vulnerabilityName ?? ''),
      dateAdded,
      dueDate: toDate(v.dueDate),
      ransomwareUse: String(v.knownRansomwareCampaignUse ?? 'Unknown'),
      shortDescription: String(v.shortDescription ?? ''),
      notes: typeof v.notes === 'string' && v.notes.trim() ? v.notes : null,
    });
  }
  return { catalogVersion: raw.catalogVersion, rows };
}

@Injectable()
export class KevService {
  fetchImpl?: typeof fetch;
  constructor(private prisma: PrismaService) {}

  /** Returns counts. Throws on any fetch/format problem (the caller records source health). */
  async sync(source: { endpoint: string; etag: string | null; lastModified: string | null }): Promise<{ notModified: boolean; added: number; updated: number; removed: number; etag?: string; lastModified?: string }> {
    const res = await safeFetch(source.endpoint, {
      allowedHosts: ALLOWED_HOSTS,
      contentTypes: /json/i,
      maxBytes: 20 * 1024 * 1024,
      timeoutMs: 45000,
      fetchImpl: this.fetchImpl,
      headers: { ...(source.etag ? { 'if-none-match': source.etag } : {}), ...(source.lastModified ? { 'if-modified-since': source.lastModified } : {}) },
    });
    if (res.notModified) return { notModified: true, added: 0, updated: 0, removed: 0 };
    let json: any;
    try {
      json = JSON.parse(res.body);
    } catch {
      throw new UpstreamFormatError('KEV response was not valid JSON');
    }
    const { catalogVersion, rows } = parseKev(json);

    const existing = await this.prisma.digestKevEntry.findMany();
    // A catalog far smaller than what we hold is more likely a bad response than a real mass removal.
    if (existing.length > 100 && rows.length < existing.length * 0.9) throw new UpstreamFormatError('KEV catalog shrank implausibly; keeping previous data');
    const byId = new Map(existing.map((e) => [e.cveId, e]));
    const incoming = new Set(rows.map((r) => r.cveId));

    const toCreate = rows.filter((r) => !byId.has(r.cveId));
    const changed = rows.filter((r) => {
      const e = byId.get(r.cveId);
      return e && (e.catalogVersion !== catalogVersion) && (e.notes !== r.notes || e.shortDescription !== r.shortDescription || e.ransomwareUse !== r.ransomwareUse || e.product !== r.product || e.vendorProject !== r.vendorProject || e.dateAdded.getTime() !== r.dateAdded.getTime() || (e.dueDate?.getTime() ?? 0) !== (r.dueDate?.getTime() ?? 0));
    });
    const removed = existing.filter((e) => !incoming.has(e.cveId)).map((e) => e.cveId);

    if (toCreate.length) await this.prisma.digestKevEntry.createMany({ data: toCreate.map((r) => ({ ...r, catalogVersion })), skipDuplicates: true });
    for (const r of changed) await this.prisma.digestKevEntry.update({ where: { cveId: r.cveId }, data: { ...r, catalogVersion, syncedAt: new Date() } });
    if (removed.length) await this.prisma.digestKevEntry.deleteMany({ where: { cveId: { in: removed } } });
    // Stamp every row with the catalog version it was last confirmed in.
    await this.prisma.digestKevEntry.updateMany({ where: { catalogVersion: { not: catalogVersion } }, data: { catalogVersion, syncedAt: new Date() } });

    return { notModified: false, added: toCreate.length, updated: changed.length, removed: removed.length, etag: res.etag, lastModified: res.lastModified };
  }
}
