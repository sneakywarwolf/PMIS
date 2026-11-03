/**
 * Builds the content of one daily digest from records that have ALREADY passed the publication gate. Pure functions:
 * no database, no network, no model. It only selects, groups, orders and counts; it never writes a claim of its own.
 * Every sentence in the executive summary is a count or a publisher headline.
 */

// ------------------------------------------------------------------- time (IST has no daylight saving: a fixed offset is exact)

export const IST_OFFSET_MIN = 330;
export const DIGEST_TZ = 'Asia/Kolkata';

/** YYYY-MM-DD of the Asia/Kolkata calendar day containing `d`. */
export function istDate(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}
/** Minutes since midnight, Asia/Kolkata. */
export function istMinutes(d: Date): number {
  const t = new Date(d.getTime() + IST_OFFSET_MIN * 60_000);
  return t.getUTCHours() * 60 + t.getUTCMinutes();
}
/** "HH:MM" (24h) -> minutes; anything else -> fallback. */
export function parseDigestTime(v: string | undefined, fallbackMin = 8 * 60): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec((v ?? '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : fallbackMin;
}

// ----------------------------------------------------------------------------------------------------------- input types

export interface StoryRow {
  id: string;
  title: string;
  url: string;
  publisher: string;
  sourceSlug: string;
  publishedAt: Date | null;
  ingestedAt: Date;
  summary: string | null;
  cveIds: string[];
  categories: string[];
  state: 'ATTRIBUTED' | 'VERIFIED';
}
export interface CvssRow { provider: string; source: string; version: string; score: number; severity: string | null }
export interface CveRow {
  cveId: string;
  recordStatus: string;
  description: string | null;
  cvss: CvssRow[];
  maxCvssSeverity: string | null;
  kevListed: boolean | null;
  nvdEnrichment: string;
}
export interface KevRow { cveId: string; vendorProject: string; product: string; name: string; dateAdded: Date; dueDate: Date | null; ransomwareUse: string; shortDescription: string }
export interface ZeroDayRow {
  cveId: string;
  description: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  evidence: { kind: string; sourceName: string; url: string; eventDate: Date | null; primary: boolean }[];
}
export interface CorrectionRow { kind: 'story' | 'zero-day'; ref: string; event: string; reason: string | null; at: Date }

export interface BuildInput {
  date: string; // IST calendar date this digest is for
  windowStart: Date;
  windowEnd: Date;
  stories: StoryRow[]; // already filtered to state ATTRIBUTED/VERIFIED and to the window
  cves: Map<string, CveRow>;
  cveChanges: Map<string, string[]>; // cveId -> change events in the window (FIRST_VERIFIED, CVSS_CHANGED, ...)
  kev: KevRow[];
  zeroDays: ZeroDayRow[]; // confirmed AND approved in the window
  zeroDayStateByCve: Map<string, string>;
  previous: { storyIds: Set<string>; kevIds: Set<string>; zeroDayCves: Set<string> };
  corrections: CorrectionRow[];
  unhealthySources: { name: string; health: string; lastSuccessAt: Date | null }[];
  counts: { pendingStories: number; conflictingStories: number; zeroDayUnverified: number; cvesAwaitingNvd: number };
  kevRetrieved: boolean;
  verificationPassFailed: boolean;
  limits?: Partial<typeof DEFAULT_LIMITS>;
}

export const DEFAULT_LIMITS = { news: 30, research: 15, cves: 30, kev: 30 };

/** The relevance policy, in the open. Order = importance. A story's position comes only from these reasons; no score is invented or shown. */
export const RANK_POLICY = [
  { reason: 'cites a confirmed zero-day', weight: 1000 },
  { reason: 'cites a CVE listed in CISA KEV', weight: 500 },
  { reason: 'verified by an analyst', weight: 200 },
  { reason: 'cites a CVE rated CRITICAL by its provider', weight: 150 },
  { reason: 'cites a CVE rated HIGH by its provider', weight: 100 },
  { reason: 'reported by several publishers', weight: 20 }, // per extra publisher, up to 4
] as const;
const W = Object.fromEntries(RANK_POLICY.map((p) => [p.reason, p.weight])) as Record<string, number>;

// ----------------------------------------------------------------------------------------------------------- output types

export interface StoryGroupItem {
  groupKey: string;
  headline: string;
  primaryStoryId: string;
  state: 'ATTRIBUTED' | 'VERIFIED';
  summary: string | null;
  categories: string[];
  cves: string[];
  zeroDay: { cveId: string; state: string }[];
  rankReasons: string[];
  sources: { storyId: string; publisher: string; url: string; publishedAt: string | null; state: string }[];
}
export interface DigestContent {
  version: 1;
  date: string;
  timezone: string;
  windowStart: string;
  windowEnd: string;
  executiveSummary: { lines: string[]; nothingQualified: boolean };
  news: StoryGroupItem[];
  cves: { cveId: string; description: string | null; recordStatus: string; cvss: CvssRow[]; kevListed: boolean | null; nvdEnrichment: string; change: 'new' | 'updated'; changes: string[] }[];
  kev: { cveId: string; vendorProject: string; product: string; name: string; dateAdded: string; dueDate: string | null; ransomwareUse: string; shortDescription: string }[];
  zeroDays: { cveId: string; description: string | null; approvedBy: string | null; approvedAt: string | null; evidence: { kind: string; sourceName: string; url: string; eventDate: string | null; primary: boolean }[] }[];
  research: { portswigger: StoryGroupItem[]; cloudflare: StoryGroupItem[] };
  corrections: { kind: string; ref: string; text: string; at: string }[];
  limitations: string[];
  omitted: { news: number; research: number; cves: number; kev: number };
  rankPolicy: { reason: string }[];
}

// ----------------------------------------------------------------------------------------------------------- grouping

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'over', 'after', 'about', 'new', 'how', 'why', 'what', 'its', 'are', 'was', 'has', 'have', 'can', 'could', 'will', 'via', 'not', 'you', 'your', 'their']);
const tokens = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 2 && !STOP.has(w)));

function similar(a: Set<string>, b: Set<string>): boolean {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return inter >= 3 && union > 0 && inter / union >= 0.6;
}

/** Same incident under different headlines: stories that cite a common CVE, or whose headlines are near-identical. */
export function groupStories(stories: StoryRow[]): StoryRow[][] {
  const parent = stories.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };
  const toks = stories.map((s) => tokens(s.title));
  const byCve = new Map<string, number>();
  stories.forEach((s, i) => {
    for (const c of s.cveIds) {
      if (byCve.has(c)) union(i, byCve.get(c)!);
      else byCve.set(c, i);
    }
  });
  for (let i = 0; i < stories.length; i++) for (let j = i + 1; j < stories.length; j++) if (find(i) !== find(j) && similar(toks[i], toks[j])) union(i, j);
  const groups = new Map<number, StoryRow[]>();
  stories.forEach((s, i) => { const r = find(i); (groups.get(r) ?? groups.set(r, []).get(r)!).push(s); });
  return [...groups.values()];
}

// ----------------------------------------------------------------------------------------------------------- build

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const eventTime = (s: StoryRow) => (s.publishedAt ?? s.ingestedAt).getTime();

function toGroupItem(members: StoryRow[], input: BuildInput): { item: StoryGroupItem; weight: number; time: number } {
  // The primary story is the analyst-verified one if any, otherwise the earliest: it is the one whose headline and summary lead.
  const sorted = [...members].sort((a, b) => (a.state === b.state ? eventTime(a) - eventTime(b) : a.state === 'VERIFIED' ? -1 : 1));
  const primary = sorted[0];
  const cves = [...new Set(members.flatMap((m) => m.cveIds))].sort();
  const reasons: string[] = [];
  let weight = 0;
  const add = (r: string, w = W[r]) => { reasons.push(r); weight += w; };
  const zd = cves.filter((c) => input.zeroDayStateByCve.get(c) === 'CONFIRMED').map((c) => ({ cveId: c, state: 'CONFIRMED' }));
  if (zd.length) add('cites a confirmed zero-day');
  if (cves.some((c) => input.cves.get(c)?.kevListed === true)) add('cites a CVE listed in CISA KEV');
  if (members.some((m) => m.state === 'VERIFIED')) add('verified by an analyst');
  const sev = cves.map((c) => input.cves.get(c)?.maxCvssSeverity).filter(Boolean);
  if (sev.includes('CRITICAL')) add('cites a CVE rated CRITICAL by its provider');
  else if (sev.includes('HIGH')) add('cites a CVE rated HIGH by its provider');
  const publishers = new Set(members.map((m) => m.publisher));
  if (publishers.size > 1) { reasons.push(`reported by ${publishers.size} publishers`); weight += W['reported by several publishers'] * Math.min(publishers.size - 1, 4); }
  const item: StoryGroupItem = {
    groupKey: [...members.map((m) => m.id)].sort()[0],
    headline: primary.title,
    primaryStoryId: primary.id,
    state: members.some((m) => m.state === 'VERIFIED') ? 'VERIFIED' : 'ATTRIBUTED',
    summary: primary.summary,
    categories: [...new Set(members.flatMap((m) => m.categories))],
    cves,
    zeroDay: zd,
    rankReasons: reasons,
    sources: sorted.map((m) => ({ storyId: m.id, publisher: m.publisher, url: m.url, publishedAt: iso(m.publishedAt), state: m.state })),
  };
  return { item, weight, time: Math.max(...members.map(eventTime)) };
}

function rankGroups(stories: StoryRow[], input: BuildInput): StoryGroupItem[] {
  return groupStories(stories)
    .map((g) => toGroupItem(g, input))
    .sort((a, b) => b.weight - a.weight || b.time - a.time || a.item.groupKey.localeCompare(b.item.groupKey))
    .map((g) => g.item);
}

export function buildDigest(input: BuildInput): DigestContent {
  const lim = { ...DEFAULT_LIMITS, ...input.limits };
  const fresh = input.stories.filter((s) => !input.previous.storyIds.has(s.id));
  const isResearch = (s: StoryRow) => s.sourceSlug.startsWith('portswigger') || s.sourceSlug === 'cloudflare-blog';
  const newsAll = rankGroups(fresh.filter((s) => !isResearch(s)), input);
  const psAll = rankGroups(fresh.filter((s) => s.sourceSlug.startsWith('portswigger')), input);
  const cfAll = rankGroups(fresh.filter((s) => s.sourceSlug === 'cloudflare-blog'), input);
  const news = newsAll.slice(0, lim.news);
  const portswigger = psAll.slice(0, lim.research);
  const cloudflare = cfAll.slice(0, lim.research);

  // CVEs: only records CVE.org actually publishes, only if something changed in the window.
  const cveAll = [...input.cveChanges.entries()]
    .map(([id, changes]) => ({ id, changes, row: input.cves.get(id) }))
    .filter((x) => x.row?.recordStatus === 'PUBLISHED')
    .sort((a, b) => Number(b.row!.kevListed === true) - Number(a.row!.kevListed === true) || (b.row!.maxCvssSeverity === 'CRITICAL' ? 1 : 0) - (a.row!.maxCvssSeverity === 'CRITICAL' ? 1 : 0) || a.id.localeCompare(b.id));
  const cves = cveAll.slice(0, lim.cves).map(({ id, changes, row }) => ({
    cveId: id,
    description: row!.description,
    recordStatus: row!.recordStatus,
    cvss: row!.cvss,
    kevListed: row!.kevListed,
    nvdEnrichment: row!.nvdEnrichment,
    change: changes.includes('FIRST_VERIFIED') ? ('new' as const) : ('updated' as const),
    changes: [...new Set(changes)],
  }));

  const kevAll = input.kev.filter((k) => !input.previous.kevIds.has(k.cveId)).sort((a, b) => b.dateAdded.getTime() - a.dateAdded.getTime() || a.cveId.localeCompare(b.cveId));
  const kev = kevAll.slice(0, lim.kev).map((k) => ({
    cveId: k.cveId, vendorProject: k.vendorProject, product: k.product, name: k.name, dateAdded: k.dateAdded.toISOString().slice(0, 10),
    dueDate: k.dueDate ? k.dueDate.toISOString().slice(0, 10) : null, ransomwareUse: k.ransomwareUse, shortDescription: k.shortDescription,
  }));

  const zeroDays = input.zeroDays.filter((z) => !input.previous.zeroDayCves.has(z.cveId)).map((z) => ({
    cveId: z.cveId, description: z.description, approvedBy: z.approvedBy, approvedAt: iso(z.approvedAt),
    evidence: z.evidence.map((e) => ({ kind: e.kind, sourceName: e.sourceName, url: e.url, eventDate: iso(e.eventDate), primary: e.primary })),
  }));

  const corrections = input.corrections.map((c) => ({ kind: c.kind, ref: c.ref, at: c.at.toISOString(), text: `${c.kind === 'zero-day' ? `Zero-day status of ${c.ref}` : `A story included in an earlier digest`} was ${c.event.toLowerCase().replace(/_/g, ' ')}${c.reason ? `: ${c.reason}` : ''}` }));

  // ----- executive summary: counts and publisher headlines only
  const shownStories = news.reduce((n, g) => n + g.sources.length, 0) + portswigger.reduce((n, g) => n + g.sources.length, 0) + cloudflare.reduce((n, g) => n + g.sources.length, 0);
  const nothing = !news.length && !portswigger.length && !cloudflare.length && !cves.length && !kev.length && !zeroDays.length && !corrections.length;
  const lines: string[] = [];
  if (nothing) {
    lines.push('No qualifying verified updates found for this period.');
  } else {
    if (zeroDays.length) lines.push(`${zeroDays.length} confirmed zero-day exploitation alert${zeroDays.length > 1 ? 's' : ''} approved by an analyst.`);
    else lines.push('No confirmed zero-day exploitation alerts.');
    if (kev.length) lines.push(`${kev.length} new CISA KEV addition${kev.length > 1 ? 's' : ''}.`);
    if (cves.length) lines.push(`${cves.length} CVE record${cves.length > 1 ? 's' : ''} newly verified or updated.`);
    if (shownStories) {
      const verified = [...news, ...portswigger, ...cloudflare].reduce((n, g) => n + g.sources.filter((s) => s.state === 'VERIFIED').length, 0);
      lines.push(`${shownStories} stor${shownStories > 1 ? 'ies' : 'y'} in ${news.length + portswigger.length + cloudflare.length} topic group${news.length + portswigger.length + cloudflare.length > 1 ? 's' : ''} (${verified} verified by an analyst; the rest are attributed reporting, not independently confirmed).`);
    }
    if (corrections.length) lines.push(`${corrections.length} correction${corrections.length > 1 ? 's' : ''} to earlier items.`);
    for (const g of news.slice(0, 3)) lines.push(`Top story: “${g.headline}”${g.rankReasons.length ? ` (${g.rankReasons.join('; ')})` : ''}`);
  }

  // ----- limitations: what this digest could NOT cover
  const limitations: string[] = ['CERT-In advisories are not included: CERT-In publishes no machine-readable feed.'];
  for (const s of input.unhealthySources) limitations.push(`${s.name} is ${s.health.toLowerCase()}${s.lastSuccessAt ? ` (last successful check ${s.lastSuccessAt.toISOString()})` : ' (never checked successfully)'}; items from it may be missing or out of date.`);
  if (!input.kevRetrieved) limitations.push('The CISA KEV catalog has not been retrieved; KEV status of every CVE is unknown.');
  if (input.verificationPassFailed) limitations.push('The verification pass that runs before this digest failed; some states may be out of date.');
  if (input.counts.pendingStories) limitations.push(`${input.counts.pendingStories} stor${input.counts.pendingStories > 1 ? 'ies are' : 'y is'} awaiting verification and not shown.`);
  if (input.counts.conflictingStories) limitations.push(`${input.counts.conflictingStories} stor${input.counts.conflictingStories > 1 ? 'ies have' : 'y has'} conflicting evidence and ${input.counts.conflictingStories > 1 ? 'are' : 'is'} not shown.`);
  if (input.counts.zeroDayUnverified) limitations.push(`${input.counts.zeroDayUnverified} zero-day claim${input.counts.zeroDayUnverified > 1 ? 's remain' : ' remains'} unverified and ${input.counts.zeroDayUnverified > 1 ? 'are' : 'is'} not shown as confirmed.`);
  if (input.counts.cvesAwaitingNvd) limitations.push(`${input.counts.cvesAwaitingNvd} CVE${input.counts.cvesAwaitingNvd > 1 ? 's are' : ' is'} awaiting NVD enrichment; their scores and affected products may be incomplete.`);

  return {
    version: 1,
    date: input.date,
    timezone: DIGEST_TZ,
    windowStart: input.windowStart.toISOString(),
    windowEnd: input.windowEnd.toISOString(),
    executiveSummary: { lines, nothingQualified: nothing },
    news,
    cves,
    kev,
    zeroDays,
    research: { portswigger, cloudflare },
    corrections,
    limitations,
    omitted: { news: Math.max(0, newsAll.length - news.length), research: Math.max(0, psAll.length - portswigger.length) + Math.max(0, cfAll.length - cloudflare.length), cves: Math.max(0, cveAll.length - cves.length), kev: Math.max(0, kevAll.length - kev.length) },
    rankPolicy: RANK_POLICY.map((p) => ({ reason: p.reason })),
  };
}
