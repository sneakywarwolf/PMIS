import { isIP } from 'net';

/**
 * The single place Cyberdigest decides what a URL may be. Used by the API (every link sent to a browser is re-checked
 * here at read time, whatever is stored), by the feed fetcher, and when administrators add hosts or sources.
 * The browser never makes this decision: it only renders what the API marks as clickable.
 */

const MAX_URL_CHARS = 2048;
const MAX_HOST_CHARS = 253;

/** Link shorteners and generic redirectors: never clickable and never addable, even by an administrator. */
export const REDIRECTOR_HOSTS: ReadonlySet<string> = new Set([
  'bit.ly', 'bitly.com', 't.co', 'tinyurl.com', 'goo.gl', 'ow.ly', 'is.gd', 'v.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'lnkd.in',
  't.ly', 'rb.gy', 'tiny.cc', 'bl.ink', 'soo.gd', 'lnk.to', 'urlz.fr', 'adf.ly', 'feedproxy.google.com', 'l.facebook.com', 'lm.facebook.com',
  'out.reddit.com', 'google.com', 'www.google.com', 'url.rw', 'trib.al', 'dlvr.it', 'fb.me', 'youtu.be', 'amzn.to', 'sn.im',
]);

export interface ParsedUrl {
  href: string; // canonical: https, lower-case ASCII (punycode) host, no fragment
  host: string;
}

export type UrlRejection =
  | 'not-a-string' | 'too-long' | 'control-characters' | 'protocol-relative' | 'malformed' | 'scheme' | 'credentials' | 'port'
  | 'ip-literal' | 'bad-host' | 'redirector' | 'not-allowlisted';

export type ParseResult = { ok: true; value: ParsedUrl } | { ok: false; reason: UrlRejection };

/** Hostname as the standard URL parser sees it, validated as a public DNS name. Returns null if it is not one. */
export function normalizeHostname(raw: string): string | null {
  if (typeof raw !== 'string' || !raw || raw.length > MAX_HOST_CHARS + 2) return null;
  if (/[\s\u0000-\u001f\\/@?#%*:\[\]]/.test(raw)) return null;
  let host: string;
  try {
    host = new URL(`https://${raw}`).hostname; // WHATWG parser: lower-cases and converts IDN to punycode
  } catch {
    return null;
  }
  host = host.replace(/\.$/, '');
  if (!host || host.length > MAX_HOST_CHARS) return null;
  if (isIP(host) || /^\d+$/.test(host.split('.').pop() ?? '')) return null; // IP forms, incl. decimal/hex/octal that the parser rewrites
  const labels = host.split('.');
  if (labels.length < 2) return null; // no single-label names (localhost, intranet hosts)
  if (!labels.every((l) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(l))) return null;
  if (/\.(local|localhost|internal|intranet|lan|home|corp|test|invalid|example)$/.test(host)) return null;
  return host;
}

/** Strict parse of one URL for display or fetching. HTTPS only. Never throws. */
export function parsePublicHttpsUrl(raw: unknown): ParseResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'not-a-string' };
  const s = raw.trim();
  if (!s || s.length > MAX_URL_CHARS) return { ok: false, reason: 'too-long' };
  if (/[\u0000-\u001f\u007f\\]/.test(s)) return { ok: false, reason: 'control-characters' };
  if (s.startsWith('//')) return { ok: false, reason: 'protocol-relative' };
  if (!/^https:\/\//i.test(s)) return { ok: false, reason: /^[a-z][a-z0-9+.-]*:/i.test(s) ? 'scheme' : 'malformed' };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (u.protocol !== 'https:') return { ok: false, reason: 'scheme' };
  if (u.username || u.password) return { ok: false, reason: 'credentials' };
  if (u.port && u.port !== '443') return { ok: false, reason: 'port' };
  const host = normalizeHostname(u.hostname);
  if (!host) return { ok: false, reason: isIP(u.hostname.replace(/^\[|\]$/g, '')) || /^[\d.]+$/.test(u.hostname) ? 'ip-literal' : 'bad-host' };
  if (REDIRECTOR_HOSTS.has(host)) return { ok: false, reason: 'redirector' };
  u.hash = '';
  return { ok: true, value: { href: u.toString(), host } };
}

/** Exact hostname equality only. `approved.example.evil.example` and `evilapproved.example` never match `approved.example`. */
export function hostAllowed(host: string, allowed: ReadonlySet<string>): boolean {
  return allowed.has(host) && !REDIRECTOR_HOSTS.has(host);
}

export interface LinkView {
  /** Present only when a user may be sent there. Absent = render `host` as plain text. */
  href: string | null;
  host: string | null;
  reason?: UrlRejection;
}

/** What the API gives a browser for any external URL: a validated clickable link, or just the host as text. */
export function linkFor(raw: unknown, allowed: ReadonlySet<string>): LinkView {
  const p = parsePublicHttpsUrl(raw);
  if (!p.ok) return { href: null, host: null, reason: p.reason };
  if (!hostAllowed(p.value.host, allowed)) return { href: null, host: p.value.host, reason: 'not-allowlisted' };
  return { href: p.value.href, host: p.value.host };
}

/** Validates an administrator-supplied hostname for the link allowlist. */
export function validateAllowlistHost(raw: unknown): { ok: true; host: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: 'A hostname is required' };
  const t = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:|\/|\?|#|@/i.test(t)) return { ok: false, error: 'Enter a bare hostname such as www.example.com, not a URL' };
  const host = normalizeHostname(t);
  if (!host) return { ok: false, error: 'Not a valid public hostname (IP addresses, single-label and internal names are refused)' };
  if (REDIRECTOR_HOSTS.has(host)) return { ok: false, error: 'Link shorteners and redirectors cannot be allowed' };
  return { ok: true, host };
}

/** Walks any JSON and replaces every `url` property with a LinkView-safe pair. Used for stored digest content, which is frozen. */
export function rewriteUrls<T>(value: T, allowed: ReadonlySet<string>): T {
  const walk = (v: any): any => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: any = {};
      for (const [k, x] of Object.entries(v)) {
        if (k === 'url' && (typeof x === 'string' || x === null)) {
          const l = linkFor(x, allowed);
          out.url = l.href;
          out.urlHost = l.host;
        } else out[k] = walk(x);
      }
      return out;
    }
    return v;
  };
  return walk(value);
}
