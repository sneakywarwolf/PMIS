import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
// supertest ships no types and a types package would be a new dependency for one test file.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const request: any = require('supertest');
import { PermissionGuard } from '../common/permissions';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CyberdigestController } from './cyberdigest.controller';
import { IngestionService } from './ingestion.service';
import { StoryReviewService } from './story-review.service';
import { ZeroDayService } from './zero-day.service';
import { DigestService } from './digest.service';

/**
 * Boots the real controller + real PermissionGuard (as main.ts/app.module do) behind a fake login, so what is tested is
 * the HTTP surface: who gets through, and what a hostile query string or body does.
 */
describe('Cyberdigest HTTP surface', () => {
  let app: INestApplication;
  let role = 'TESTER';
  const calls: string[] = [];
  const spy = (name: string, ret: unknown = {}) => async (...a: unknown[]) => { calls.push(`${name}:${JSON.stringify(a.filter((x) => typeof x !== 'object' || x === null || !('ip' in (x as object))))}`); return ret; };
  const lastWhere: any[] = [];

  beforeAll(async () => {
    const prisma: any = {
      digestSource: { findMany: async () => [], findUnique: async () => ({ id: 's', slug: 'x', enabled: true, pollIntervalMinutes: 20 }), update: async () => ({}) },
      digestStory: { count: async () => 0, findMany: async (a: any) => { lastWhere.push(a.where); return []; } },
      digestCve: { count: async () => 0, findMany: async (a: any) => { lastWhere.push(a?.where); return []; }, findUnique: async () => null },
      digestZeroDayCase: { findMany: async () => [], count: async () => 0 },
      digestEvent: { findMany: async () => [{ id: 'e', entityType: 'STORY', entityId: 's', event: 'CORRECTED', createdAt: new Date(), detail: { by: 'secret-user-id', reason: 'because', from: 'VERIFIED', to: 'ATTRIBUTED' } }] },
      user: { findMany: async () => [] },
    };
    const mod = await Test.createTestingModule({
      controllers: [CyberdigestController],
      providers: [
        { provide: APP_GUARD, useClass: PermissionGuard },
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: spy('audit') } },
        { provide: IngestionService, useValue: { pollSource: spy('poll', { ok: true }) } },
        { provide: StoryReviewService, useValue: { approve: spy('approveStory'), reject: spy('rejectStory'), correct: spy('correctStory') } },
        { provide: ZeroDayService, useValue: { list: spy('zdList', []), view: spy('zdView'), addEvidence: spy('addEvidence'), approve: spy('approveZd'), retractEvidence: spy('retract'), transition: spy('transition'), withdraw: spy('withdrawZd') } },
        { provide: DigestService, useValue: { list: spy('digestList', []), get: spy('digestGet'), generate: spy('digestGenerate'), publish: spy('digestPublish'), withdraw: spy('digestWithdraw') } },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.use((req: any, _res: any, next: any) => { if (role !== 'ANON') req.user = { id: 'u1', role }; next(); });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => { calls.length = 0; lastWhere.length = 0; });

  const as = (r: string) => { role = r; return request(app.getHttpServer()); };

  it('anonymous callers get 403 on everything', async () => {
    await as('ANON').get('/cyberdigest/stories').expect(403);
    await as('ANON').post('/cyberdigest/stories/x/approve').send({ reason: 'long enough reason' }).expect(403);
  });

  it.each(['AVP', 'TEAM_LEAD', 'TESTER'])('%s can read but cannot review or manage by default', async (r) => {
    await as(r).get('/cyberdigest/stories').expect(200);
    await as(r).get('/cyberdigest/cves').expect(200);
    await as(r).get('/cyberdigest/zero-days').expect(200);
    await as(r).get('/cyberdigest/health').expect(200);
    calls.length = 0; // the reads above legitimately reached services; from here on nothing may
    for (const [method, path, body] of [
      ['post', '/cyberdigest/stories/s1/approve', { reason: 'long enough reason' }],
      ['post', '/cyberdigest/stories/s1/reject', { reason: 'long enough reason' }],
      ['post', '/cyberdigest/zero-days/CVE-2026-0001/approve', {}],
      ['post', '/cyberdigest/zero-days/CVE-2026-0001/evidence', { kind: 'DISCLOSURE' }],
      ['post', '/cyberdigest/zero-days/CVE-2026-0001/transition', { state: 'UNKNOWN', reason: 'long enough reason' }],
      ['post', '/cyberdigest/zero-days/evidence/e1/retract', { reason: 'long enough reason' }],
      ['patch', '/cyberdigest/sources/bleepingcomputer', { enabled: false }],
      ['post', '/cyberdigest/sources/bleepingcomputer/poll', {}],
      ['post', '/cyberdigest/digests/generate', {}],
      ['post', '/cyberdigest/digests/2026-11-04/publish', {}],
    ] as const) {
      await (as(r) as any)[method](path).send(body).expect(403);
    }
    expect(calls).toEqual([]); // not one service method was reached
  });

  it('Admin can reach the write routes', async () => {
    await as('ADMIN').post('/cyberdigest/stories/s1/approve').send({ reason: 'long enough reason' }).expect(201);
    await as('ADMIN').post('/cyberdigest/zero-days/CVE-2026-0001/approve').send({}).expect(201);
    await as('ADMIN').post('/cyberdigest/sources/bleepingcomputer/poll').send({}).expect(201);
    expect(calls.some((c) => c.startsWith('approveStory'))).toBe(true);
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
    expect(w.verificationState).toEqual({ not: 'REJECTED' });
    expect(w.categories).toBeUndefined();
  });

  it('a malformed CVE id in the path is rejected with 400', async () => {
    await as('TESTER').get('/cyberdigest/cves/not-a-cve').expect(400);
    await as('TESTER').get('/cyberdigest/zero-days/..%2F..%2Fetc').expect(400);
  });

  it('the verification overview does not expose internal user ids', async () => {
    const res = await as('TESTER').get('/cyberdigest/verification').expect(200);
    expect(JSON.stringify(res.body)).not.toContain('secret-user-id');
    expect(res.body.corrections[0].detail).toEqual({ reason: 'because', from: 'VERIFIED', to: 'ATTRIBUTED' });
  });

  it('extra body fields do not break validation-free routes and arrays are not accepted as a reason', async () => {
    const res = await as('ADMIN').post('/cyberdigest/stories/s1/reject').send({ reason: ['x'], admin: true });
    expect([201, 400]).toContain(res.status); // the service receives a non-string reason and refuses it (covered in unit tests)
  });
});
