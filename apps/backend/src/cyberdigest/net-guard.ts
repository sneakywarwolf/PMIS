import * as dns from 'dns';
import * as https from 'https';
import { isIP } from 'net';

/**
 * Connect-time SSRF protection. Checking a hostname before a request is not enough: DNS can answer differently a
 * moment later (rebinding), or return internal addresses for a public-looking name. So the address actually connected
 * to is validated here, inside the socket's own DNS lookup, and the connection is pinned to that exact address.
 */

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((n, o) => n * 256 + Number(o), 0);
}
const inV4 = (ip: string, base: string, bits: number) => {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) >>> 0 === (ipv4ToInt(base) & mask) >>> 0;
};
const BLOCKED_V4: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

/** True for any address a feed fetch must never reach: private, loopback, link-local, metadata, multicast, reserved, unspecified. */
export function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return BLOCKED_V4.some(([b, bits]) => inV4(ip, b, bits));
  if (kind === 6) {
    const a = ip.toLowerCase();
    const mapped = /^(?:::ffff:|::ffff:0:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(a); // IPv4 inside IPv6
    if (mapped) return isBlockedIp(mapped[1]);
    const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(a);
    if (hexMapped) {
      const n = (parseInt(hexMapped[1], 16) << 16) | parseInt(hexMapped[2], 16);
      return isBlockedIp([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
    }
    if (a === '::' || a === '::1') return true;
    // link-local, unique-local, multicast, documentation, Teredo, 6to4, site-local, and the NAT64 prefix (it embeds an IPv4 address we cannot vouch for)
    return /^(fe[89ab][0-9a-f]:|f[cd][0-9a-f]{2}:|ff[0-9a-f]{2}:|2001:db8:|2001:0?:|2002:|fec0:|64:ff9b:)/.test(a) || a.startsWith('::');
  }
  return true; // not an IP at all: refuse
}

export class BlockedAddressError extends Error {
  constructor(readonly host: string) {
    super('Destination resolves to a blocked address');
  }
}

type Lookup = (hostname: string, options: dns.LookupAllOptions, cb: (err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void) => void;

/** DNS lookup for https.request: resolves, refuses if ANY answer is blocked, then hands the socket one validated address. */
export function guardedLookup(resolve: Lookup = dns.lookup as unknown as Lookup) {
  return (hostname: string, _options: unknown, cb: (err: Error | null, address?: string | dns.LookupAddress[], family?: number) => void) => {
    resolve(hostname, { all: true, verbatim: true }, (err, addrs) => {
      if (err) return cb(err);
      if (!addrs?.length) return cb(new Error('No address'));
      if (addrs.some((a) => isBlockedIp(a.address))) return cb(new BlockedAddressError(hostname));
      const first = addrs[0];
      const opts = _options as { all?: boolean } | undefined;
      return opts?.all ? cb(null, [first]) : cb(null, first.address, first.family);
    });
  };
}

export interface GuardedFetchOptions {
  maxBytes?: number;
  lookup?: ReturnType<typeof guardedLookup>;
}

/**
 * `fetch`-shaped GET over node:https with the guarded lookup. No redirects are followed (the caller re-validates every
 * hop), the body is capped while it streams, and a hard socket timeout applies. Resolves with a standard Response.
 */
export function createGuardedFetch(opts: GuardedFetchOptions = {}): typeof fetch {
  const maxBytes = opts.maxBytes ?? 25 * 1024 * 1024;
  const lookup = opts.lookup ?? guardedLookup();
  return ((input: unknown, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const url = new URL(String(input));
      if (url.protocol !== 'https:') return reject(new Error('https only'));
      const signal = init?.signal ?? undefined;
      const headers: Record<string, string> = {};
      new Headers(init?.headers as any).forEach((v, k) => (headers[k] = v));
      headers['accept-encoding'] = 'identity'; // no compression: sizes are what they say, and there is no decompression bomb
      const req = https.request(
        { method: 'GET', hostname: url.hostname, port: 443, path: url.pathname + url.search, headers, lookup: lookup as any, agent: false, servername: url.hostname, timeout: 30_000 },
        (res) => {
          const chunks: Buffer[] = [];
          let total = 0;
          res.on('data', (c: Buffer) => {
            total += c.length;
            if (total > maxBytes) {
              req.destroy(new Error('Response too large'));
              return;
            }
            chunks.push(c);
          });
          res.on('end', () => {
            const h = new Headers();
            for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) h.set(k, Array.isArray(v) ? v.join(', ') : String(v));
            const status = res.statusCode ?? 502;
            const bodyless = status === 204 || status === 205 || status === 304 || (status >= 300 && status < 400);
            resolve(new Response(bodyless ? null : Buffer.concat(chunks), { status, headers: h }));
          });
          res.on('error', reject);
        },
      );
      req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { name: 'TimeoutError' })));
      req.on('error', (e) => reject(e));
      signal?.addEventListener('abort', () => req.destroy(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
      req.end();
    })) as unknown as typeof fetch;
}
