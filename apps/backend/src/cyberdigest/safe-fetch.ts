import { BlockedAddressError, createGuardedFetch } from "./net-guard";
import { hostAllowed, parsePublicHttpsUrl } from "./url-policy";
/**
 * The only way Cyberdigest touches the network. External content is untrusted, so: https only, hostname must be in the
 * allowlist (no IP literals, no ports), every redirect hop is re-checked, bounded time and bytes, and the content type
 * must be one the caller expects. Hosts are fixed publisher names from the registry, which is what keeps SSRF out.
 */
export class SafeFetchError extends Error {
  constructor(
    message: string,
    readonly kind: 'blocked' | 'http' | 'rate_limited' | 'timeout' | 'too_large' | 'bad_type' | 'network',
    readonly status?: number,
    readonly retryAfterSec?: number,
  ) {
    super(message);
  }
}

export interface SafeFetchOptions {
  allowedHosts: ReadonlySet<string>;
  contentTypes: RegExp;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
}

export interface SafeFetchResult {
  status: number;
  notModified: boolean;
  body: string;
  finalUrl: string;
  etag?: string;
  lastModified?: string;
}

/** Every outbound URL goes through the one central policy, then must be an exact allowlisted host. */
export function assertAllowedUrl(raw: string, allowed: ReadonlySet<string>): URL {
  const p = parsePublicHttpsUrl(raw);
  if (!p.ok || !hostAllowed(p.value.host, allowed)) {
    throw new SafeFetchError(`Blocked URL: ${p.ok ? p.value.host : p.reason}`, 'blocked');
  }
  return new URL(p.value.href);
}

// One transport for the process: resolves DNS itself and refuses private/loopback/metadata addresses at connect time.
let defaultTransport: typeof fetch | undefined;
const transport = () => (defaultTransport ??= createGuardedFetch());

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new SafeFetchError('Response too large', 'too_large');
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new SafeFetchError('Response too large', 'too_large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function safeFetch(url: string, opts: SafeFetchOptions): Promise<SafeFetchResult> {
  const doFetch = opts.fetchImpl ?? transport();
  const maxRedirects = opts.maxRedirects ?? 3;
  let current = assertAllowedUrl(url, opts.allowedHosts).toString();
  let extraHeaders = opts.headers;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    let res: Response;
    try {
      res = await doFetch(current, {
        redirect: 'manual',
        headers: { 'user-agent': 'PMIS-Cyberdigest/1.0', accept: '*/*', ...extraHeaders },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15000),
      });
    } catch (e: any) {
      if (e instanceof BlockedAddressError || e?.cause instanceof BlockedAddressError) throw new SafeFetchError('Destination resolves to a blocked address', 'blocked');
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new SafeFetchError('Request timed out', 'timeout');
      throw new SafeFetchError('Network error', 'network');
    }
    if (res.status >= 300 && res.status < 400 && res.status !== 304) {
      const loc = res.headers.get('location');
      if (!loc) throw new SafeFetchError('Redirect without location', 'http', res.status);
      const next = assertAllowedUrl(new URL(loc, current).toString(), opts.allowedHosts);
      // Credentials (e.g. the NVD apiKey) and validators belong to the host they were meant for, not to wherever it redirects.
      if (next.hostname !== new URL(current).hostname) extraHeaders = undefined;
      current = next.toString();
      continue;
    }
    if (res.status === 304) return { status: 304, notModified: true, body: '', finalUrl: current };
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after'));
      throw new SafeFetchError('Rate limited', 'rate_limited', 429, Number.isFinite(ra) && ra > 0 ? ra : undefined);
    }
    if (!res.ok) throw new SafeFetchError(`HTTP ${res.status}`, 'http', res.status);
    if (!opts.contentTypes.test(res.headers.get('content-type') || '')) throw new SafeFetchError('Unexpected content type', 'bad_type', res.status);
    const body = await readCapped(res, opts.maxBytes ?? 5 * 1024 * 1024);
    return { status: res.status, notModified: false, body, finalUrl: current, etag: res.headers.get('etag') ?? undefined, lastModified: res.headers.get('last-modified') ?? undefined };
  }
  throw new SafeFetchError('Too many redirects', 'http');
}
