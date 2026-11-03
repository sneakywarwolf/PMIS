import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { BadRequestException } from '@nestjs/common';
import { CyberdigestController, StrOnly } from './cyberdigest.controller';
import { PERMISSION_KEY, permissionRules } from '../common/permissions';
import { safeFetch, SafeFetchError } from './safe-fetch';
import { ALLOWED_HOSTS } from './sources.config';
import { parseFeed } from './feed-parser';
import { publicError } from './cve-verification.service';
import { UpstreamFormatError } from './cve-clients';
import { ZeroDayService } from './zero-day.service';
import { StoryReviewService } from './story-review.service';

const proto = CyberdigestController.prototype as any;
const routes = Object.getOwnPropertyNames(proto)
  .filter((n) => n !== 'constructor' && typeof proto[n] === 'function' && Reflect.getMetadata(METHOD_METADATA, proto[n]) !== undefined)
  .map((n) => ({ name: n, method: Reflect.getMetadata(METHOD_METADATA, proto[n]) as RequestMethod, path: Reflect.getMetadata(PATH_METADATA, proto[n]) as string, key: Reflect.getMetadata(PERMISSION_KEY, proto[n]) as string | undefined }));

describe('authorization: every Cyberdigest route is gated (PermissionGuard allows routes with no @Permission)', () => {
  // 17 routes today; the test after this one is what protects any route added later.
  it('finds the routes', () => expect(routes.length).toBeGreaterThanOrEqual(17));
  it('no route is missing a @Permission', () => expect(routes.filter((r) => !r.key).map((r) => r.name)).toEqual([]));
  it('reads need cyberdigest.view; every write needs review or manage_sources', () => {
    for (const r of routes) {
      if (r.method === RequestMethod.GET) expect([r.name, r.key]).toEqual([r.name, 'cyberdigest.view']);
      else expect(['cyberdigest.review', 'cyberdigest.manage_sources']).toContain(r.key);
    }
  });
  it('source management routes need manage_sources, decisions need review', () => {
    for (const r of routes.filter((x) => /^(updateSource|pollNow)$/.test(x.name))) expect(r.key).toBe('cyberdigest.manage_sources');
    for (const r of routes.filter((x) => /(approve|reject|correct|retract|transition|withdraw|addEvidence)/i.test(x.name))) expect(r.key).toBe('cyberdigest.review');
  });
  it('by default only Admin can review or manage; every role can read', () => {
    for (const role of ['AVP', 'TEAM_LEAD', 'TESTER']) {
      expect(permissionRules.can(role, 'cyberdigest.view')).toBe(true);
      expect(permissionRules.can(role, 'cyberdigest.review')).toBe(false);
      expect(permissionRules.can(role, 'cyberdigest.manage_sources')).toBe(false);
    }
    expect(permissionRules.can('ADMIN', 'cyberdigest.review')).toBe(true);
    expect(permissionRules.can(undefined, 'cyberdigest.view')).toBe(false);
  });
});

describe('query input', () => {
  it('arrays and objects (?q=a&q=b, ?q[x]=1) are treated as absent, never reaching string methods', () => {
    const p = new StrOnly();
    expect(p.transform('abc')).toBe('abc');
    expect(p.transform(['a', 'b'])).toBeUndefined();
    expect(p.transform({ x: '1' })).toBeUndefined();
    expect(p.transform(undefined)).toBeUndefined();
  });
});

describe('outbound requests', () => {
  const html = (status: number, headers: Record<string, string> = {}) => new Response('{}', { status, headers: { 'content-type': 'application/json', ...headers } });

  it('credentials are not forwarded when a redirect leaves the host they were meant for', async () => {
    const seen: { url: string; headers: any }[] = [];
    const fetchImpl = (async (u: string, init: any) => {
      seen.push({ url: u, headers: init.headers });
      return u.includes('services.nvd.nist.gov') ? new Response(null, { status: 302, headers: { location: 'https://www.cisa.gov/x' } }) : html(200);
    }) as any;
    await safeFetch('https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-2021-44228', { allowedHosts: ALLOWED_HOSTS, contentTypes: /json/, headers: { apiKey: 'SECRET' }, fetchImpl });
    expect(seen[0].headers.apiKey).toBe('SECRET');
    expect(seen[1].url).toContain('www.cisa.gov');
    expect(seen[1].headers.apiKey).toBeUndefined();
  });

  it('credentials are kept on a same-host redirect', async () => {
    const seen: any[] = [];
    const fetchImpl = (async (u: string, init: any) => {
      seen.push(init.headers);
      return seen.length === 1 ? new Response(null, { status: 301, headers: { location: '/rest/json/cves/2.0?cveId=CVE-2021-44228&x=1' } }) : html(200);
    }) as any;
    await safeFetch('https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-2021-44228', { allowedHosts: ALLOWED_HOSTS, contentTypes: /json/, headers: { apiKey: 'SECRET' }, fetchImpl });
    expect(seen[1].apiKey).toBe('SECRET');
  });

  it.each([
    'https://169.254.169.254/latest/meta-data', 'https://localhost/', 'https://[::1]/', 'https://0x7f000001/', 'http://www.cisa.gov/x',
    'https://www.cisa.gov.evil.example/', 'https://evil.example/www.cisa.gov', 'https://www.cisa.gov@evil.example/', 'ftp://www.cisa.gov/x', 'gopher://www.cisa.gov/',
  ])('blocks %s', async (u) => {
    await expect(safeFetch(u, { allowedHosts: ALLOWED_HOSTS, contentTypes: /.*/, fetchImpl: (async () => { throw new Error('must not be called'); }) as any })).rejects.toMatchObject({ kind: 'blocked' });
  });

  it('stops a redirect chain', async () => {
    const loop = (async () => new Response(null, { status: 302, headers: { location: 'https://www.cisa.gov/again' } })) as any;
    await expect(safeFetch('https://www.cisa.gov/start', { allowedHosts: ALLOWED_HOSTS, contentTypes: /.*/, fetchImpl: loop })).rejects.toMatchObject({ kind: 'http' });
  });
});

describe('hostile feed content', () => {
  it('a flood of unclosed <script> tags is handled in linear time', () => {
    const bomb = `<script>`.repeat(250_000); // 2 MB
    const xml = `<rss><channel><item><title>t</title><link>https://www.bleepingcomputer.com/a/</link><description><![CDATA[${bomb}]]></description></item></channel></rss>`;
    const t = Date.now();
    const [item] = parseFeed(xml);
    expect(Date.now() - t).toBeLessThan(3000);
    expect(item.description.length).toBeLessThan(20_001);
  });
  it('markup and entity-encoded markup end up as plain text only', () => {
    const xml = `<rss><channel><item><title>&lt;img src=x onerror=alert(1)&gt;Title</title><link>https://www.bleepingcomputer.com/a/</link><description>&lt;script&gt;alert(1)&lt;/script&gt;ok &lt;b&gt;bold&lt;/b&gt;</description></item></channel></rss>`;
    const [i] = parseFeed(xml);
    expect(i.title).not.toMatch(/[<>]/);
    expect(i.description).not.toMatch(/[<>]/);
  });
  it('refuses entity-expansion payloads', () => {
    const lol = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]><rss><channel><item><title>&b;</title><link>https://x.example/</link></item></channel></rss>`;
    expect(() => parseFeed(lol)).toThrow();
  });
});

describe('no internal detail reaches the dashboard', () => {
  it('only our own network/format errors are described', () => {
    expect(publicError(new SafeFetchError('Rate limited', 'rate_limited', 429))).toBe('rate_limited: Rate limited');
    expect(publicError(new UpstreamFormatError('Unexpected KEV catalog shape'))).toBe('format: Unexpected KEV catalog shape');
    expect(publicError(new Error('connect ECONNREFUSED 10.0.0.5:5432 password authentication failed for user "vapt_user"'))).toBe('internal error');
    expect(publicError('weird')).toBe('internal error');
  });
});

describe('abuse limits', () => {
  it('evidence per case is capped', async () => {
    const evidence = Array.from({ length: 100 }, (_, i) => ({ id: `e${i}` }));
    const prisma: any = {
      digestZeroDayCase: { findUnique: async () => ({ id: 'c1', cveId: 'CVE-2026-0001' }) },
      digestZeroDayEvidence: { count: async () => evidence.length, create: async () => { throw new Error('should not be reached'); } },
    };
    const svc = new ZeroDayService(prisma, { log: async () => undefined } as any);
    await expect(svc.addEvidence('CVE-2026-0001', { kind: 'DISCLOSURE', sourceType: 'VENDOR', sourceName: 'V', url: 'https://v.example/a' }, { id: 'u', ip: '', userAgent: '' })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('analyst reasons are length-bounded before storage', async () => {
    let stored = '';
    const story = { id: 's1', cveIds: [], canonicalUrl: 'https://n.example/a', verificationState: 'ATTRIBUTED' };
    const prisma: any = { digestStory: { findUnique: async () => story, updateMany: async ({ data }: any) => { stored = data.stateNote; return { count: 1 }; } }, digestCve: { findMany: async () => [] }, digestEvent: { create: async () => undefined } };
    await new StoryReviewService(prisma, { log: async () => undefined } as any).reject('s1', 'x'.repeat(50_000), { id: 'u', ip: '', userAgent: '' });
    expect(stored.length).toBe(1000);
  });
});
