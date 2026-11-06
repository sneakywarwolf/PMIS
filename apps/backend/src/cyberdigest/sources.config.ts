/**
 * Central registry of approved Cyberdigest sources. Endpoints and polling policy live here (and, once seeded, in the
 * DigestSource table) so they can change without touching ingestion logic. Adding a publisher needs documented approval.
 * Endpoints were checked against the live publishers on 2026-11-03; nothing here is guessed.
 *
 * News publishers are DISCOVERY sources only: an article proves the publisher reported something, not that it is true.
 * CVE.org / NVD / CISA KEV are AUTHORITATIVE and are consumed by the verification services (cve-verification.service,
 * kev.service), never by the news ingester.
 */
export type DigestSourceTypeName = 'NEWS_RSS' | 'RESEARCH_RSS' | 'CVE_API' | 'NVD_API' | 'KEV_JSON';

export interface SourceDef {
  slug: string;
  name: string;
  type: DigestSourceTypeName;
  endpoint: string;
  website: string;
  trustRole: 'DISCOVERY' | 'AUTHORITATIVE';
  pollIntervalMinutes: number;
  /** Seeded enabled? false until the code that consumes this source exists. */
  enabled: boolean;
}

export const SOURCES: SourceDef[] = [
  // thehackernews.com/feeds/posts/default 302s to this Feedburner URL, so the registry uses it directly.
  { slug: 'thehackernews', name: 'The Hacker News', type: 'NEWS_RSS', endpoint: 'https://feeds.feedburner.com/TheHackersNews', website: 'https://thehackernews.com/', trustRole: 'DISCOVERY', pollIntervalMinutes: 20, enabled: true },
  { slug: 'bleepingcomputer', name: 'BleepingComputer', type: 'NEWS_RSS', endpoint: 'https://www.bleepingcomputer.com/feed/', website: 'https://www.bleepingcomputer.com/news/security/', trustRole: 'DISCOVERY', pollIntervalMinutes: 20, enabled: true },
  { slug: 'cybersecuritynews', name: 'Cyber Security News', type: 'NEWS_RSS', endpoint: 'https://cybersecuritynews.com/feed/', website: 'https://cybersecuritynews.com/', trustRole: 'DISCOVERY', pollIntervalMinutes: 20, enabled: true },
  { slug: 'portswigger-blog', name: 'PortSwigger Blog', type: 'RESEARCH_RSS', endpoint: 'https://portswigger.net/blog/rss', website: 'https://portswigger.net/blog', trustRole: 'DISCOVERY', pollIntervalMinutes: 30, enabled: true },
  { slug: 'portswigger-research', name: 'PortSwigger Research', type: 'RESEARCH_RSS', endpoint: 'https://portswigger.net/research/rss', website: 'https://portswigger.net/research', trustRole: 'DISCOVERY', pollIntervalMinutes: 30, enabled: true },
  { slug: 'cloudflare-blog', name: 'Cloudflare Blog', type: 'RESEARCH_RSS', endpoint: 'https://blog.cloudflare.com/rss/', website: 'https://blog.cloudflare.com/', trustRole: 'DISCOVERY', pollIntervalMinutes: 30, enabled: true },
  // Authoritative sources. CVE.org and NVD are queried per CVE (their health reflects the last lookups); KEV is polled.
  { slug: 'cve-org', name: 'CVE Program', type: 'CVE_API', endpoint: 'https://cveawg.mitre.org/api/cve/', website: 'https://www.cve.org/', trustRole: 'AUTHORITATIVE', pollIntervalMinutes: 60, enabled: true },
  { slug: 'nvd', name: 'NIST NVD', type: 'NVD_API', endpoint: 'https://services.nvd.nist.gov/rest/json/cves/2.0', website: 'https://nvd.nist.gov/', trustRole: 'AUTHORITATIVE', pollIntervalMinutes: 60, enabled: true },
  { slug: 'cisa-kev', name: 'CISA KEV', type: 'KEV_JSON', endpoint: 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json', website: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog', trustRole: 'AUTHORITATIVE', pollIntervalMinutes: 45, enabled: true },
];

/**
 * Initial list of hosts users may click through to. Seeded into the database once; after that the administrator owns
 * the list (Cyberdigest > Administration). Exact hostnames only: `blog.cloudflare.com` does not allow `cloudflare.com`.
 */
export const DEFAULT_LINK_HOSTS: readonly string[] = [
  'thehackernews.com', 'www.bleepingcomputer.com', 'bleepingcomputer.com', 'cybersecuritynews.com',
  'www.cve.org', 'cve.org', 'nvd.nist.gov', 'www.cisa.gov', 'cisa.gov',
  'www.cert-in.org.in', 'cert-in.org.in', 'portswigger.net', 'blog.cloudflare.com', 'www.cloudflare.com',
];

/** Only these hosts may ever be fetched. Derived from the registry so the two cannot drift. */
export const ALLOWED_HOSTS: ReadonlySet<string> = new Set(SOURCES.map((s) => new URL(s.endpoint).hostname));
