import { linkFor, parsePublicHttpsUrl, hostAllowed, validateAllowlistHost, normalizeHostname, rewriteUrls, REDIRECTOR_HOSTS } from './url-policy';
import { isBlockedIp, guardedLookup, BlockedAddressError, createGuardedFetch } from './net-guard';
import { safeFetch } from './safe-fetch';
import { DEFAULT_LINK_HOSTS, ALLOWED_HOSTS } from './sources.config';

const LINKS = new Set(DEFAULT_LINK_HOSTS);
const reasonOf = (u: unknown) => { const p = parsePublicHttpsUrl(u); return p.ok ? 'ok' : p.reason; };

describe('URL policy: schemes and shapes', () => {
  it.each([
    ['javascript:alert(1)', 'scheme'], ['JaVaScRiPt:alert(1)', 'scheme'], ['data:text/html,<script>alert(1)</script>', 'scheme'], ['file:///etc/passwd', 'scheme'],
    ['blob:https://www.cisa.gov/uuid', 'scheme'], ['vbscript:msgbox(1)', 'scheme'], ['ftp://www.cisa.gov/x', 'scheme'], ['http://www.cisa.gov/x', 'scheme'],
    ['//www.cisa.gov/x', 'protocol-relative'], ['  //evil.example/x', 'protocol-relative'], ['/relative/path', 'malformed'], ['www.cisa.gov/x', 'malformed'], ['', 'too-long'], ['https://', 'malformed'],
    ['https://www.cisa.gov\\@evil.example/', 'control-characters'], ['https://www.cisa.gov/\u0000x', 'control-characters'], ['https://www.cisa.gov/\nx', 'control-characters'],
    ['https://approved.example@malicious.example/', 'credentials'], ['https://user:pass@www.cisa.gov/', 'credentials'],
    ['https://www.cisa.gov:8443/', 'port'], ['https://www.cisa.gov:80/', 'port'],
    ['https://127.0.0.1/', 'ip-literal'], ['https://[::1]/', 'ip-literal'], ['https://0x7f000001/', 'ip-literal'], ['https://2130706433/', 'ip-literal'], ['https://017700000001/', 'ip-literal'], ['https://169.254.169.254/latest/meta-data', 'ip-literal'], ['https://[::ffff:127.0.0.1]/', 'ip-literal'], ['https://10.0.0.1/', 'ip-literal'],
    ['https://localhost/', 'bad-host'], ['https://intranet/', 'bad-host'], ['https://db.internal/', 'bad-host'], ['https://printer.local/', 'bad-host'], ['https://host.example/', 'bad-host'],
    ['https://bit.ly/abc', 'redirector'], ['https://t.co/abc', 'redirector'], ['https://tinyurl.com/x', 'redirector'], ['https://www.google.com/url?q=https://www.cisa.gov', 'redirector'],
    [null, 'not-a-string'], [undefined, 'not-a-string'], [{ toString: () => 'https://www.cisa.gov' }, 'not-a-string'], [['https://www.cisa.gov'], 'not-a-string'],
  ])('refuses %j (%s)', (input, reason) => expect(reasonOf(input)).toBe(reason));

  it('refuses over-long URLs', () => expect(reasonOf(`https://www.cisa.gov/${'a'.repeat(3000)}`)).toBe('too-long'));
  it('encoded and double-encoded schemes are not schemes: they stay inside a valid https URL or are refused', () => {
    expect(reasonOf('%6Aavascript:alert(1)')).toBe('malformed');
    expect(reasonOf('javascript%3Aalert(1)')).toBe('malformed');
    const p = parsePublicHttpsUrl('https://www.cisa.gov/%256Aavascript:alert(1)');
    expect(p.ok && p.value.href.startsWith('https://www.cisa.gov/')).toBe(true); // a path on the right host, not a script
  });
  it('canonicalises: lower-case host, no fragment, default port dropped, trailing dot removed', () => {
    const p = parsePublicHttpsUrl('HTTPS://WWW.CISA.GOV.:443/path?x=1#frag');
    expect(p).toMatchObject({ ok: true, value: { host: 'www.cisa.gov' } });
    expect((p as any).value.href).toBe('https://www.cisa.gov./path?x=1');
  });
  it('IDN look-alikes become punycode and therefore never match the real host', () => {
    expect(normalizeHostname('www.cisa.gov')).toBe('www.cisa.gov');
    const lookalike = normalizeHostname('www.cіsa.gov'); // Cyrillic i
    expect(lookalike).toMatch(/^www\.xn--/);
    expect(hostAllowed(lookalike!, LINKS)).toBe(false);
  });
});

describe('URL policy: hostname matching is exact, never substring', () => {
  const ok = (u: string) => linkFor(u, LINKS).href !== null;
  it('allows exactly the listed hosts', () => {
    for (const u of ['https://www.cisa.gov/x', 'https://nvd.nist.gov/vuln/detail/CVE-2021-44228', 'https://portswigger.net/blog/x', 'https://blog.cloudflare.com/x', 'https://thehackernews.com/2026/x.html']) expect(ok(u)).toBe(true);
  });
  it.each([
    'https://www.cisa.gov.evil.example/x', 'https://evilwww.cisa.gov/x', 'https://cisa.gov.evil.example/', 'https://www.cisa.gov-evil.example/', 'https://evil.example/www.cisa.gov',
    'https://evil.example/?u=https://www.cisa.gov', 'https://approved.example.malicious.example/', 'https://sub.www.cisa.gov/x', 'https://cloudflare.com.evil.example/',
    'https://evil.example#www.cisa.gov', 'https://evil.example\\.www.cisa.gov', 'https://www.cisa.gov%2eevil.example/',
  ])('does not treat %s as allowed', (u) => expect(ok(u)).toBe(false));
  it('a subdomain of an allowed host is NOT allowed unless it is listed itself', () => {
    expect(linkFor('https://blog.cloudflare.com/x', new Set(['cloudflare.com'])).href).toBeNull();
    expect(linkFor('https://cloudflare.com/x', new Set(['blog.cloudflare.com'])).href).toBeNull();
  });
  it('an off-list host is shown as text (host only), a malformed URL as nothing', () => {
    expect(linkFor('https://evil.example.net/x', LINKS)).toEqual({ href: null, host: 'evil.example.net', reason: 'not-allowlisted' });
    expect(linkFor('javascript:alert(1)', LINKS)).toMatchObject({ href: null, host: null });
  });
  it('a redirector can never be allowed, even if it is on the list', () => {
    expect(hostAllowed('bit.ly', new Set(['bit.ly']))).toBe(false);
    expect(linkFor('https://bit.ly/x', new Set(['bit.ly'])).href).toBeNull();
  });
  it('the shipped link list is exact hostnames only: no wildcards, schemes or paths, nothing a redirector', () => {
    for (const h of DEFAULT_LINK_HOSTS) {
      expect(normalizeHostname(h)).toBe(h);
      expect(REDIRECTOR_HOSTS.has(h)).toBe(false);
    }
  });
});

describe('administrator allowlist input', () => {
  it('accepts a bare public hostname and normalises it', () => {
    expect(validateAllowlistHost(' Www.Example.ORG ')).toEqual({ ok: true, host: 'www.example.org' });
  });
  it.each(['https://www.example.org', 'www.example.org/path', '*.example.org', 'example.org?x', 'user@example.org', '127.0.0.1', '[::1]', 'localhost', 'intranet', '10.0.0.5', 'a b.org', 'bit.ly', 't.co', '', '   ', 'javascript:alert(1)', 'host:8080'])('refuses %j', (v) => {
    expect(validateAllowlistHost(v).ok).toBe(false);
  });
  it('refuses non-strings', () => {
    for (const v of [null, undefined, 42, {}, ['a.org']]) expect(validateAllowlistHost(v).ok).toBe(false);
  });
});

describe('stored content is re-validated before it reaches a browser', () => {
  it('rewrites every url property, at any depth, and drops what is not allowed', () => {
    const stored = { news: [{ headline: 'h', sources: [{ url: 'https://www.cisa.gov/ok' }, { url: 'javascript:alert(1)' }, { url: 'https://evil.example.net/x' }, { url: null }] }], other: { url: 'data:text/html,x' } };
    const out: any = rewriteUrls(stored, LINKS);
    expect(out.news[0].sources).toEqual([{ url: 'https://www.cisa.gov/ok', urlHost: 'www.cisa.gov' }, { url: null, urlHost: null }, { url: null, urlHost: 'evil.example.net' }, { url: null, urlHost: null }]);
    expect(out.other).toEqual({ url: null, urlHost: null });
    expect(JSON.stringify(stored)).toContain('javascript:'); // the input is untouched
  });
});

describe('SSRF: blocked addresses', () => {
  it.each([
    '127.0.0.1', '127.255.255.254', '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '169.254.0.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255', '192.0.2.1', '198.51.100.7', '203.0.113.9', '198.18.0.1',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.1.2.3', '::ffff:169.254.169.254', '::ffff:7f00:1', '64:ff9b::7f00:1', '2001:db8::1', 'not-an-ip', '',
  ])('blocks %s', (ip) => expect(isBlockedIp(ip)).toBe(true));
  it.each(['8.8.8.8', '1.1.1.1', '104.18.2.1', '151.101.1.1', '172.15.255.255', '172.32.0.1', '2606:4700:4700::1111', '2a00:1450:4009::200e'])('allows public %s', (ip) => expect(isBlockedIp(ip)).toBe(false));
});

describe('SSRF: connect-time DNS validation (rebinding)', () => {
  const resolverReturning = (...addrs: { address: string; family: number }[]) => ((_h: string, _o: unknown, cb: (e: Error | null, a: typeof addrs) => void) => cb(null, addrs)) as any;
  const run = (lookup: ReturnType<typeof guardedLookup>, all = false) => new Promise<{ err: Error | null; address?: unknown }>((res) => lookup('feed.example.net', all ? { all: true } : {}, (err, address) => res({ err, address })));

  it('passes a public answer and pins the socket to that exact address', async () => {
    const r = await run(guardedLookup(resolverReturning({ address: '104.18.2.1', family: 4 })));
    expect(r).toEqual({ err: null, address: '104.18.2.1' });
    expect((await run(guardedLookup(resolverReturning({ address: '104.18.2.1', family: 4 })), true)).address).toEqual([{ address: '104.18.2.1', family: 4 }]);
  });
  it('refuses a public-looking name that resolves to an internal address', async () => {
    for (const bad of ['127.0.0.1', '10.0.0.7', '169.254.169.254', '::1', '192.168.0.10']) {
      const r = await run(guardedLookup(resolverReturning({ address: bad, family: bad.includes(':') ? 6 : 4 })));
      expect(r.err).toBeInstanceOf(BlockedAddressError);
    }
  });
  it('refuses when ANY answer is internal (a mixed answer is the classic rebinding trick)', async () => {
    const r = await run(guardedLookup(resolverReturning({ address: '104.18.2.1', family: 4 }, { address: '127.0.0.1', family: 4 })));
    expect(r.err).toBeInstanceOf(BlockedAddressError);
  });
  it('a resolver that changes its answer between lookups is checked every time, not once', async () => {
    let n = 0;
    const flip = ((_h: string, _o: unknown, cb: any) => cb(null, n++ === 0 ? [{ address: '104.18.2.1', family: 4 }] : [{ address: '127.0.0.1', family: 4 }])) as any;
    const lookup = guardedLookup(flip);
    expect((await run(lookup)).err).toBeNull();
    expect((await run(lookup)).err).toBeInstanceOf(BlockedAddressError);
  });
  it('propagates resolver failures and empty answers as errors, never as success', async () => {
    expect((await run(guardedLookup(((_h: string, _o: unknown, cb: any) => cb(new Error('ENOTFOUND'))) as any))).err?.message).toBe('ENOTFOUND');
    expect((await run(guardedLookup(resolverReturning()))).err).toBeInstanceOf(Error);
  });
  it('the guarded transport reports a blocked address as a blocked fetch', async () => {
    const guarded = createGuardedFetch({ lookup: guardedLookup(resolverReturning({ address: '169.254.169.254', family: 4 })) });
    await expect(safeFetch('https://www.cisa.gov/x', { allowedHosts: ALLOWED_HOSTS, contentTypes: /.*/, fetchImpl: guarded })).rejects.toMatchObject({ kind: 'blocked' });
  });
});

describe('SSRF: redirects and hosts', () => {
  const opts = (fetchImpl: any) => ({ allowedHosts: ALLOWED_HOSTS, contentTypes: /.*/, fetchImpl });
  it('refuses a feed that redirects to an unapproved or internal destination (and does not request it)', async () => {
    for (const to of ['https://evil.example.net/x', 'http://www.cisa.gov/x', 'https://169.254.169.254/latest', 'https://localhost/admin', 'javascript:alert(1)', '//evil.example.net/x', 'https://www.cisa.gov.evil.example/']) {
      const seen: string[] = [];
      const impl = (async (u: string) => { seen.push(u); return new Response(null, { status: 302, headers: { location: to } }); }) as any;
      await expect(safeFetch('https://www.cisa.gov/start', opts(impl))).rejects.toMatchObject({ kind: 'blocked' });
      expect(seen).toEqual(['https://www.cisa.gov/start']);
    }
  });
  it('limits redirect chains', async () => {
    const impl = (async (u: string) => new Response(null, { status: 302, headers: { location: u.endsWith('/a') ? 'https://www.cisa.gov/b' : 'https://www.cisa.gov/a' } })) as any;
    await expect(safeFetch('https://www.cisa.gov/a', opts(impl))).rejects.toMatchObject({ kind: 'http' });
  });
  it('no internal credentials or cookies are ever sent: only the headers the caller supplies', async () => {
    let sent: any;
    await safeFetch('https://www.cisa.gov/x', opts((async (_u: string, init: any) => { sent = init.headers; return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); }) as any));
    expect(Object.keys(sent).sort()).toEqual(['accept', 'user-agent']);
  });
  it('a URL written inside article text is never fetched: only registry endpoints are', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, 'ingestion.service.ts'), 'utf8') as string;
    const uses = [...src.matchAll(/safeFetch\(([^,]+),/g)].map((m) => m[1].trim());
    expect(uses).toEqual(['source.endpoint']);
  });
});
