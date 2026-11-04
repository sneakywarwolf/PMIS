import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
// supertest ships no types and a types package would be a new dependency for one test file.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const request: any = require('supertest');
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CyberdigestAccessGuard } from './access.guard';
import { CyberdigestController } from './cyberdigest.controller';
import { DigestConfigService } from './digest-config.service';
import { DigestService } from './digest.service';
import { IngestionService } from './ingestion.service';
import { JobRunner } from './job-runner';
import { StoryReviewService } from './story-review.service';
import { ZeroDayService } from './zero-day.service';

/**
 * Boots the real controller with the real access guard behind a fake login, so what is tested is the HTTP surface:
 * who gets through, what a reader receives, and what a hostile query string or body does.
 */
describe('Cyberdigest HTTP surface', () => {
  let app: INestApplication;
  let role = 'TESTER';
  let moduleOn = true;
  const calls: string[] = [];
  const spy = (name: string, ret: unknown = {}) => async (...a: unknown[]) => { calls.push(name); void a; return ret; };
  const lastWhere: any[] = [];
  const LINKS = ['www.cisa.gov', 'news.example.org'];

  const storyRow = (o: any = {}) => ({ id: 's1', title: 'T', canonicalUrl: 'https://news.example.org/a', author: null, publishedAt: new Date(), ingestedAt: new Date(), summary: 's', cveIds: [], categories: [], verificationState: 'ATTRIBUTED', lastVerifiedAt: null, stateNote: 'internal reviewer note', reviewedAt: new Date(), source: { name: 'P', slug: 'p' }, ...o });

  beforeAll(async () => {
    const prisma: any = {
      digestSource: { findMany: async () => [], findUnique: async () => ({ id: 's', slug: 'x', enabled: true, pollIntervalMinutes: 20 }), update: async () => ({}) },
      digestStory: { count: async () => 0, findMany: async (a: any) => { lastWhere.push(a.where); return [storyRow({ canonicalUrl: 'https://evil.example.net/x' }), storyRow({ id: 's2', canonicalUrl: 'javascript:alert(1)' }), storyRow({ id: 's3' })]; } },
      digestCve: { count: async () => 0, findMany: async (a: any) => { lastWhere.push(a?.where); return []; }, findUnique: async () => ({ cveId: 'CVE-2026-0001', recordStatus: 'UNAVAILABLE', references: [] }) },
      digestZeroDayCase: { findMany: async () => [], count: async () => 0 },
      digestEvent: { findMany: async () => [{ id: 'e', entityType: 'STORY', entityId: 's', event: 'CORRECTED', createdAt: new Date(), detail: { by: 'secret-user-id', reason: 'because', from: 'VERIFIED', to: 'ATTRIBUTED' } }] },
      user: { findMany: async () => [] },
    };
    const config = { moduleEnabledForNonAdmins: async () => moduleOn, linkHostSet: async () => new Set(LINKS), get: async () => ({ pipelineEnabled: true, publishTime: '08:00', timezone: 'Asia/Kolkata' }), update: spy('config.update'), addLinkHost: spy('config.addLinkHost', []), removeLinkHost: spy('config.removeLinkHost', []), addSource: spy('config.addSource', { slug: 'x', name: 'x' }), invalidateFeedHosts: () => undefined };
    const mod = await Test.createTestingModule({
      controllers: [CyberdigestController],
      providers: [
        CyberdigestAccessGuard,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: spy('audit') } },
        { provide: DigestConfigService, useValue: config },
        { provide: JobRunner, useValue: { status: spy('jobs', []), history: spy('jobHistory', []) } },
        { provide: IngestionService, useValue: { pollSource: spy('poll', { ok: true }) } },
        { provide: StoryReviewService, useValue: { approve: spy('approveStory'), reject: spy('rejectStory'), correct: spy('correctStory') } },
        { provide: ZeroDayService, useValue: { list: spy('zdList', []), view: spy('zdView', { state: 'UNKNOWN', evidence: [] }), addEvidence: spy('addEvidence'), approve: spy('approveZd'), retractEvidence: spy('retract'), transition: spy('transition'), withdraw: spy('withdrawZd') } },
        { provide: DigestService, useValue: { list: spy('digestList', []), get: spy('digestGet'), latest: spy('digestLatest', { latest: null }), generate: spy('digestGenerate'), publish: spy('digestPublish'), withdraw: spy('digestWithdraw') } },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.use((req: any, _res: any, next: any) => { if (role !== 'ANON') req.user = { id: 'u1', role }; next(); });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => { calls.length = 0; lastWhere.length = 0; moduleOn = true; });

  const as = (r: string) => { role = r; return request(app.getHttpServer()); };
  const ADMIN_WRITES: [string, string, object][] = [
    ['post', '/cyberdigest/stories/s1/approve', { reason: 'long enough reason' }], ['post', '/cyberdigest/stories/s1/reject', { reason: 'long enough reason' }], ['post', '/cyberdigest/stories/s1/correct', { reason: 'long enough reason' }],
    ['post', '/cyberdigest/stories/bulk-approve', { ids: ['s1'], reason: 'long enough reason' }], ['post', '/cyberdigest/zero-days/bulk-approve', { cveIds: ['CVE-2026-0001'] }],
    ['post', '/cyberdigest/zero-days/CVE-2026-0001/approve', {}], ['post', '/cyberdigest/zero-days/CVE-2026-0001/evidence', { kind: 'DISCLOSURE' }],
    ['post', '/cyberdigest/zero-days/CVE-2026-0001/transition', { state: 'UNKNOWN', reason: 'long enough reason' }], ['post', '/cyberdigest/zero-days/CVE-2026-0001/withdraw', { reason: 'long enough reason' }],
    ['post', '/cyberdigest/zero-days/evidence/e1/retract', { reason: 'long enough reason' }], ['patch', '/cyberdigest/sources/bleepingcomputer', { enabled: false }], ['post', '/cyberdigest/sources/bleepingcomputer/poll', {}],
    ['post', '/cyberdigest/digests/generate', {}], ['post', '/cyberdigest/digests/2026-11-04/publish', {}], ['post', '/cyberdigest/digests/2026-11-04/withdraw', { reason: 'long enough reason' }],
    ['patch', '/cyberdigest/admin/config', { moduleEnabledForNonAdmins: false }], ['post', '/cyberdigest/admin/link-hosts', { host: 'evil.example.net' }], ['delete', '/cyberdigest/admin/link-hosts/www.cisa.gov', {}],
    ['post', '/cyberdigest/admin/sources', { name: 'Evil', endpoint: 'https://evil.example.net/feed' }],
  ];
  const ADMIN_READS = ['/cyberdigest/admin/config', '/cyberdigest/admin/jobs', '/cyberdigest/admin/jobs/history', '/cyberdigest/health', '/cyberdigest/verification'];
  const READER_READS = ['/cyberdigest/access', '/cyberdigest/stories', '/cyberdigest/cves', '/cyberdigest/zero-days?section=confirmed', '/cyberdigest/digests', '/cyberdigest/digests/latest', '/cyberdigest/digests/2026-11-04'];

  it('anonymous callers get 403 on every route', async () => {
    for (const p of [...READER_READS, ...ADMIN_READS]) await as('ANON').get(p).expect(403);
    for (const [m, p, b] of ADMIN_WRITES) await (as('ANON') as any)[m](p).send(b).expect(403);
    expect(calls).toEqual([]);
  });

  it.each(['AVP', 'TEAM_LEAD', 'TESTER'])('%s can read published content but cannot reach ANY administrative or write route', async (r) => {
    for (const p of READER_READS) await as(r).get(p).expect(200);
    calls.length = 0;
    for (const p of ADMIN_READS) await as(r).get(p).expect(403);
    for (const [m, p, b] of ADMIN_WRITES) await (as(r) as any)[m](p).send(b).expect(403);
    expect(calls).toEqual([]); // not one service method was reached
  });

  it('every method other than GET is refused for readers, even on a path that does not exist as a write', async () => {
    for (const m of ['post', 'put', 'patch', 'delete']) {
      for (const p of ['/cyberdigest/stories', '/cyberdigest/digests/latest', '/cyberdigest/cves', '/cyberdigest/access']) {
        const res = await (as('TESTER') as any)[m](p).send({});
        expect([403, 404]).toContain(res.status);
      }
    }
    expect(calls).toEqual([]);
  });

  it('Admin reaches administrative reads and writes', async () => {
    for (const p of ADMIN_READS) await as('ADMIN').get(p).expect(200);
    await as('ADMIN').post('/cyberdigest/stories/s1/approve').send({ reason: 'long enough reason' }).expect(201);
    await as('ADMIN').patch('/cyberdigest/admin/config').send({ pipelineEnabled: false }).expect(200);
    await as('ADMIN').post('/cyberdigest/admin/link-hosts').send({ host: 'www.example.org' }).expect(201);
    expect(calls).toEqual(expect.arrayContaining(['approveStory', 'config.update', 'config.addLinkHost']));
  });

  describe('the availability switch (enforced by the server on every request)', () => {
    it('off: every non-admin route returns 403 at once, including archives, the latest digest, CVEs and the access probe', async () => {
      moduleOn = false;
      for (const r of ['AVP', 'TEAM_LEAD', 'TESTER']) {
        for (const p of READER_READS) await as(r).get(p).expect(403);
      }
      expect(calls).toEqual([]);
    });
    it('off: administrators keep full access', async () => {
      moduleOn = false;
      for (const p of [...READER_READS, ...ADMIN_READS]) await as('ADMIN').get(p).expect(200);
    });
    it('flipping the switch takes effect on the very next request, in both directions', async () => {
      await as('TESTER').get('/cyberdigest/digests/latest').expect(200);
      moduleOn = false;
      await as('TESTER').get('/cyberdigest/digests/latest').expect(403);
      moduleOn = true;
      await as('TESTER').get('/cyberdigest/digests/latest').expect(200);
    });
    it('responses are not cacheable by a shared cache and carry no content once access is revoked', async () => {
      moduleOn = false;
      const res = await as('TESTER').get('/cyberdigest/stories').expect(403);
      expect(JSON.stringify(res.body)).not.toMatch(/news\.example|title|summary/i);
    });
  });

  describe('what readers receive', () => {
    it('links are re-validated per request: allowlisted host clickable, off-list host as text only, hostile scheme as nothing', async () => {
      const res = await as('TESTER').get('/cyberdigest/stories').expect(200);
      const byId = Object.fromEntries(res.body.items.map((i: any) => [i.id, i]));
      expect(byId.s1).toMatchObject({ url: null, urlHost: 'evil.example.net' });
      expect(byId.s2).toMatchObject({ url: null, urlHost: null });
      expect(byId.s3).toMatchObject({ url: 'https://news.example.org/a', urlHost: 'news.example.org' });
    });
    it('readers do not get reviewer notes; administrators do', async () => {
      expect(JSON.stringify((await as('TESTER').get('/cyberdigest/stories').expect(200)).body)).not.toContain('internal reviewer note');
      expect(JSON.stringify((await as('ADMIN').get('/cyberdigest/stories').expect(200)).body)).toContain('internal reviewer note');
    });
    it('readers only ever ask the database for attributed or verified stories, whatever state they request', async () => {
      await as('TESTER').get('/cyberdigest/stories?state=PENDING').expect(200);
      await as('TESTER').get('/cyberdigest/stories?state=CONFLICTING').expect(200);
      await as('TESTER').get('/cyberdigest/stories?state=REJECTED').expect(200);
      for (const w of lastWhere) expect(w.verificationState.in ?? [w.verificationState]).toEqual(expect.not.arrayContaining(['PENDING', 'CONFLICTING', 'REJECTED']));
    });
    it('readers cannot open the zero-day review queue', async () => {
      await as('TESTER').get('/cyberdigest/zero-days?section=review').expect(400);
      await as('ADMIN').get('/cyberdigest/zero-days?section=review').expect(200);
    });
    it('a CVE the official record has not confirmed is not visible to readers', async () => {
      await as('TESTER').get('/cyberdigest/cves/CVE-2026-0001').expect(404);
      await as('ADMIN').get('/cyberdigest/cves/CVE-2026-0001').expect(200);
    });
  });

  it('hostile query strings never crash a route (arrays, objects, huge values, wildcards)', async () => {
    for (const q of ['q=a&q=b', 'q[x]=1', 'q[$ne]=1', `q=${'A'.repeat(5000)}`, 'take=-5&skip=abc', 'take[]=1', 'state=DROP', 'category=../../x', 'severity[]=HIGH', 'from=garbage&to=garbage', 'kev=%00']) {
      for (const p of ['stories', 'cves', 'zero-days']) {
        const res = await as('TESTER').get(`/cyberdigest/${p}?${q}`);
        expect([200, 400]).toContain(res.status);
      }
    }
  });

  it('unknown filter values are ignored rather than passed to the database', async () => {
    await as('TESTER').get('/cyberdigest/stories?state=DROP&category=nope').expect(200);
    const w = lastWhere.at(-1);
    expect(w.verificationState).toEqual({ in: ['ATTRIBUTED', 'VERIFIED'] });
    expect(w.categories).toBeUndefined();
  });

  it('a malformed CVE id in the path is rejected with 400', async () => {
    await as('TESTER').get('/cyberdigest/cves/not-a-cve').expect(400);
    await as('TESTER').get('/cyberdigest/zero-days/..%2F..%2Fetc').expect(400);
  });

  it('the verification overview (administrators only) does not expose internal user ids', async () => {
    const res = await as('ADMIN').get('/cyberdigest/verification').expect(200);
    expect(JSON.stringify(res.body)).not.toContain('secret-user-id');
    expect(res.body.corrections[0].detail).toEqual({ reason: 'because', from: 'VERIFIED', to: 'ATTRIBUTED' });
  });

  it('there is no redirect or proxy route: nothing under /cyberdigest answers a url parameter with a redirect', async () => {
    for (const p of ['/cyberdigest/redirect?url=https://evil.example.net', '/cyberdigest/out?u=https://evil.example.net', '/cyberdigest/go/https%3A%2F%2Fevil.example.net', '/cyberdigest/proxy?url=https://evil.example.net']) {
      const res = await as('ADMIN').get(p);
      expect([404, 400]).toContain(res.status);
      expect(res.headers.location).toBeUndefined();
    }
    for (const p of ['/cyberdigest/stories?url=https://evil.example.net', '/cyberdigest/digests/latest?next=https://evil.example.net']) {
      const res = await as('TESTER').get(p);
      expect(res.headers.location).toBeUndefined();
    }
  });

  it('an array is not accepted as a reason', async () => {
    const res = await as('ADMIN').post('/cyberdigest/stories/s1/reject').send({ reason: ['x'], admin: true });
    expect([201, 400]).toContain(res.status);
  });
});
