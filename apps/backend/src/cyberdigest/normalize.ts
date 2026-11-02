import { createHash } from 'crypto';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const TRACKING = /^(utm_|fbclid$|gclid$|mc_|ref$|source$)/i;

/** https, lower-case host, no fragment / tracking params / trailing slash, sorted query: same page => same string. */
export function canonicalUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    u.protocol = 'https:';
    u.hash = '';
    u.port = '';
    [...u.searchParams.keys()].filter((k) => TRACKING.test(k)).forEach((k) => u.searchParams.delete(k));
    u.searchParams.sort();
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    return u.toString();
  } catch {
    return null;
  }
}

/** Identity of a story within a source: re-publishing the same URL never creates a second story. */
export const dedupKey = (sourceSlug: string, canonical: string) => sha256(`${sourceSlug}|${canonical}`);

/** Detects a real content change (correction/update) as opposed to a re-seen item. */
export const contentHash = (title: string, description: string) => sha256(`${title}\n${description}`);

/** Syntactic CVE extraction only. A match here is NOT evidence the CVE exists; Phase 2 verifies against CVE.org. */
export function extractCveIds(...texts: string[]): string[] {
  const found = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(/\bCVE-\d{4}-\d{4,19}\b/gi)) found.add(m[0].toUpperCase());
  return [...found].sort();
}

/** Extractive summary: the publisher's own words, cut at a sentence boundary. Nothing is added or rewritten. */
export function extractiveSummary(description: string, max = 300): string | null {
  const d = description.trim();
  if (!d) return null;
  if (d.length <= max) return d;
  const cut = d.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > max * 0.4 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '…';
}
