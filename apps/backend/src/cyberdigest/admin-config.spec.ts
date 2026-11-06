import { BadRequestException, ConflictException } from '@nestjs/common';
import { DigestConfigService, validateConfigPatch, isValidTimezone } from './digest-config.service';
import { JobRunner, backoffMinutes } from './job-runner';
import { DEFAULT_LINK_HOSTS } from './sources.config';

const A = { id: 'admin1', ip: '1.1.1.1', userAgent: 'jest' };

function cfgFakes() {
  let row: any = null;
  const sources: any[] = [];
  const audits: any[] = [];
  const prisma: any = {
    sources,
    digestConfig: {
      findUnique: async () => (row ? { ...row } : null),
      create: async ({ data }: any) => { row = { moduleEnabledForNonAdmins: true, pipelineEnabled: true, publishTime: '08:00', timezone: 'Asia/Kolkata', publishMode: 'AUTO', minDiscoveryCoveragePct: 50, retentionDays: 365, jobRetryBackoffMinutes: 10, updatedAt: new Date(), updatedById: null, ...data }; return row; },
      update: async ({ data }: any) => Object.assign(row, data),
    },
    digestSource: {
      findMany: async () => sources.filter((s) => s.enabled),
      findUnique: async ({ where }: any) => sources.find((s) => s.slug === where.slug) ?? null,
      count: async () => sources.length,
      create: async ({ data }: any) => { const s = { id: `src${sources.length}`, ...data }; sources.push(s); return s; },
    },
  };
  const audit = { log: async (a: any) => { audits.push(a); } };
  return { prisma, svc: new DigestConfigService(prisma, audit as any), audits, sources, row: () => row };
}

describe('config validation (server side, whatever the screen allowed)', () => {
  it('accepts valid values', () => {
    expect(validateConfigPatch({ publishTime: '07:45', timezone: 'Asia/Kolkata', publishMode: 'HOLD', minDiscoveryCoveragePct: 0, retentionDays: 30, jobRetryBackoffMinutes: 120, moduleEnabledForNonAdmins: false, pipelineEnabled: true })).toBeNull();
  });
  it.each([
    [{ publishTime: '8:00' }], [{ publishTime: '24:00' }], [{ publishTime: 'noon' }], [{ publishTime: 800 }], [{ timezone: 'Mars/Olympus' }], [{ timezone: '' }], [{ timezone: 'x'.repeat(100) }], [{ publishMode: 'NOW' }],
    [{ minDiscoveryCoveragePct: 101 }], [{ minDiscoveryCoveragePct: -1 }], [{ minDiscoveryCoveragePct: 50.5 }], [{ retentionDays: 5 }], [{ retentionDays: 99999 }], [{ jobRetryBackoffMinutes: 0 }],
    [{ moduleEnabledForNonAdmins: 'false' }], [{ pipelineEnabled: 1 }], [{ linkHosts: ['evil.example.net'] }], [{ id: 'other' }], [{ updatedById: 'me' }], [{ __proto__: { x: 1 }, nope: 1 }], [[]], [null], ['x'],
  ])('refuses %j', (patch) => expect(validateConfigPatch(patch as any)).not.toBeNull());
  it('timezones come from the built-in zone database', () => {
    expect(isValidTimezone('Asia/Kolkata')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('Asia/Nowhere')).toBe(false);
    expect(isValidTimezone(42)).toBe(false);
  });
});

describe('DigestConfigService', () => {
  it('first read seeds safe defaults, including the shipped link list', async () => {
    const f = cfgFakes();
    const c = await f.svc.get();
    expect(c).toMatchObject({ moduleEnabledForNonAdmins: true, pipelineEnabled: true, publishTime: '08:00', timezone: 'Asia/Kolkata', publishMode: 'AUTO' });
    expect(c.linkHosts).toEqual([...DEFAULT_LINK_HOSTS]);
  });
  it('the two switches are independent', async () => {
    const f = cfgFakes();
    await f.svc.update({ moduleEnabledForNonAdmins: false }, A);
    expect(await f.svc.moduleEnabledForNonAdmins()).toBe(false);
    expect(await f.svc.pipelineEnabled()).toBe(true);
    await f.svc.update({ pipelineEnabled: false }, A);
    expect(await f.svc.pipelineEnabled()).toBe(false);
    await f.svc.update({ moduleEnabledForNonAdmins: true }, A);
    expect(await f.svc.moduleEnabledForNonAdmins()).toBe(true);
    expect(await f.svc.pipelineEnabled()).toBe(false);
  });
  it('every change is audited with who, what, before and after; a no-op writes nothing', async () => {
    const f = cfgFakes();
    await f.svc.update({ publishTime: '09:15', retentionDays: 90 }, A);
    expect(f.audits).toHaveLength(1);
    expect(f.audits[0]).toMatchObject({ actorId: 'admin1', action: 'CYBERDIGEST_CONFIG_UPDATED', details: { changes: { publishTime: { from: '08:00', to: '09:15' }, retentionDays: { from: 365, to: 90 } } } });
    await f.svc.update({ publishTime: '09:15' }, A);
    expect(f.audits).toHaveLength(1);
  });
  it('an invalid patch is rejected before anything is written', async () => {
    const f = cfgFakes();
    await expect(f.svc.update({ publishTime: 'bad' }, A)).rejects.toBeInstanceOf(BadRequestException);
    expect(f.audits).toEqual([]);
  });

  it('link allowlist: adds exact hosts, refuses bad ones and duplicates, audits both directions', async () => {
    const f = cfgFakes();
    expect(await f.svc.addLinkHost('Vendor.Example.ORG', A)).toContain('vendor.example.org');
    await expect(f.svc.addLinkHost('vendor.example.org', A)).rejects.toBeInstanceOf(ConflictException);
    for (const bad of ['https://x.example.org', '*.example.org', '127.0.0.1', 'localhost', 'bit.ly', '', null, 'a/b']) await expect(f.svc.addLinkHost(bad, A)).rejects.toBeInstanceOf(BadRequestException);
    expect(await f.svc.removeLinkHost('vendor.example.org', A)).not.toContain('vendor.example.org');
    await expect(f.svc.removeLinkHost('vendor.example.org', A)).rejects.toThrow();
    expect(f.audits.map((a) => [a.action, a.details.added ?? a.details.removed])).toEqual([['CYBERDIGEST_ALLOWLIST_CHANGED', 'vendor.example.org'], ['CYBERDIGEST_ALLOWLIST_CHANGED', 'vendor.example.org']]);
  });

  describe('adding a source (one action covers fetching and clicking)', () => {
    it('adds the feed, makes its host fetchable, and allows its website for links', async () => {
      const f = cfgFakes();
      await f.svc.get();
      expect((await f.svc.feedHostSet()).has('feeds.vendor.example.org')).toBe(false);
      const s = await f.svc.addSource({ name: 'Vendor blog', endpoint: 'https://feeds.vendor.example.org/rss', website: 'https://blog.vendor.example.org/' }, A);
      expect(s).toMatchObject({ type: 'NEWS_RSS', trustRole: 'DISCOVERY', enabled: true });
      expect((await f.svc.feedHostSet()).has('feeds.vendor.example.org')).toBe(true);
      expect((await f.svc.get()).linkHosts).toContain('blog.vendor.example.org');
      expect(f.audits.at(-1)).toMatchObject({ action: 'CYBERDIGEST_SOURCE_ADDED', details: { linkHostsAdded: ['blog.vendor.example.org'] } });
    });
    it('refuses internal, non-https, credentialed, shortener and malformed feed URLs', async () => {
      const f = cfgFakes();
      for (const endpoint of ['http://feeds.example.org/rss', 'https://127.0.0.1/rss', 'https://localhost/rss', 'https://169.254.169.254/latest', 'https://user:pw@feeds.example.org/rss', 'https://bit.ly/abc', 'javascript:alert(1)', 'ftp://x.example.org/f', 'https://feeds.example.org:8443/rss', 'nonsense', '', null]) {
        await expect(f.svc.addSource({ name: 'Evil feed', endpoint }, A)).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(f.sources).toEqual([]);
    });
    it('needs a real name and refuses a duplicate feed', async () => {
      const f = cfgFakes();
      await expect(f.svc.addSource({ name: 'x', endpoint: 'https://feeds.example.org/rss' }, A)).rejects.toBeInstanceOf(BadRequestException);
      await f.svc.addSource({ name: 'Example feed', endpoint: 'https://feeds.example.org/rss' }, A);
      await expect(f.svc.addSource({ name: 'Example feed', endpoint: 'https://feeds.example.org/rss' }, A)).rejects.toBeInstanceOf(ConflictException);
    });
    it('a disabled source no longer widens the hosts the server may fetch', async () => {
      const f = cfgFakes();
      await f.svc.addSource({ name: 'Example feed', endpoint: 'https://feeds.example.org/rss' }, A);
      expect((await f.svc.feedHostSet()).has('feeds.example.org')).toBe(true);
      f.sources[0].enabled = false;
      f.svc.invalidateFeedHosts();
      expect((await f.svc.feedHostSet()).has('feeds.example.org')).toBe(false);
    });
  });
});

describe('JobRunner', () => {
  function runnerFakes(pipelineEnabled = true) {
    const runs: any[] = [];
    const locks: any[] = [];
    let id = 0;
    const prisma: any = {
      digestJobRun: {
        findMany: async ({ where }: any) => runs.filter((r) => r.job === where.job && where.status.in.includes(r.status)).sort((a, b) => b.startedAt - a.startedAt).slice(0, 10),
        findFirst: async ({ where }: any) => runs.filter((r) => r.job === where.job && (!where.status || r.status === where.status)).sort((a, b) => b.startedAt - a.startedAt)[0] ?? null,
        count: async ({ where }: any) => runs.filter((r) => r.job === where.job && r.status === where.status && r.startedAt >= where.startedAt.gte).length,
        create: async ({ data }: any) => { const r = { id: `r${++id}`, finishedAt: null, error: null, ...data }; runs.push(r); return r; },
        update: async ({ where, data }: any) => Object.assign(runs.find((r) => r.id === where.id), data),
        updateMany: async ({ where, data }: any) => { const hit = runs.filter((r) => r.job === where.job && r.status === where.status && r.startedAt < where.startedAt.lt); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length }; },
      },
      digestLock: {
        updateMany: async ({ where, data }: any) => { const l = locks.find((x) => x.name === where.name && (x.expiresAt < where.OR[0].expiresAt.lt || x.holder === where.OR[1].holder)); if (l) Object.assign(l, data); return { count: l ? 1 : 0 }; },
        create: async ({ data }: any) => { if (locks.some((x) => x.name === data.name)) throw Object.assign(new Error('dup'), { code: 'P2002' }); locks.push({ ...data }); },
        deleteMany: async ({ where }: any) => { for (let i = locks.length - 1; i >= 0; i--) if (locks[i].name === where.name && locks[i].holder === where.holder) locks.splice(i, 1); return { count: 1 }; },
      },
    };
    const config: any = { get: async () => ({ pipelineEnabled, jobRetryBackoffMinutes: 10 }) };
    return { prisma, runs, locks, runner: new JobRunner(prisma, config), config };
  }
  const T = (m: number) => new Date(Date.UTC(2026, 10, 4, 0, 0) + m * 60_000);

  it('records a successful run with its detail', async () => {
    const f = runnerFakes();
    expect(await f.runner.run('ingestion', async () => ({ polled: 3 }), { now: T(0) })).toBe('ran');
    expect(f.runs[0]).toMatchObject({ job: 'ingestion', status: 'OK', detail: { polled: 3 } });
    expect(f.locks).toEqual([]); // the lease is released
  });
  it('a paused pipeline runs nothing and records nothing, except housekeeping that opts out', async () => {
    const f = runnerFakes(false);
    let ran = 0;
    expect(await f.runner.run('digest', async () => { ran++; }, { now: T(0) })).toBe('skipped');
    expect(await f.runner.run('retention', async () => { ran++; }, { now: T(0), requirePipeline: false })).toBe('ran');
    expect(ran).toBe(1);
  });
  it('a failure is recorded with a safe message (never the raw error) and does not throw', async () => {
    const f = runnerFakes();
    expect(await f.runner.run('digest', async () => { throw new Error('connect ECONNREFUSED 10.0.0.5:5432 password authentication failed'); }, { now: T(0) })).toBe('failed');
    expect(f.runs[0]).toMatchObject({ status: 'FAILED', error: 'internal error' });
  });
  it('retries with exponential backoff and recovers on its own', async () => {
    const f = runnerFakes();
    let fail = true;
    const job = async () => { if (fail) throw new Error('x'); return { ok: true }; };
    expect(await f.runner.run('digest', job, { now: T(0) })).toBe('failed');
    expect(await f.runner.run('digest', job, { now: T(5) })).toBe('skipped'); // inside the 10-minute delay
    expect(await f.runner.run('digest', job, { now: T(11) })).toBe('failed'); // second failure -> 20-minute delay
    expect(await f.runner.run('digest', job, { now: T(25) })).toBe('skipped');
    fail = false;
    expect(await f.runner.run('digest', job, { now: T(40) })).toBe('ran');
    expect((await f.runner.failureStreak('digest')).streak).toBe(0);
    expect([0, 1, 2, 3, 9].map((n) => backoffMinutes(10, n))).toEqual([0, 10, 20, 40, 60]);
  });
  it('two workers cannot run the same job at once; an expired lease does not block forever', async () => {
    const f = runnerFakes();
    const other = new JobRunner(f.prisma, f.config);
    let inner: string | undefined;
    await f.runner.run('digest', async () => { inner = await other.run('digest', async () => undefined, { now: T(1) }); }, { now: T(0) });
    expect(inner).toBe('skipped');
    f.locks.push({ name: 'ingestion', holder: 'crashed-worker', expiresAt: T(-30) }); // left behind by a crash
    expect(await other.run('ingestion', async () => ({}), { now: T(0) })).toBe('ran');
  });
  it('a run left RUNNING by a crashed worker is closed out as failed', async () => {
    const f = runnerFakes();
    f.runs.push({ id: 'old', job: 'digest', status: 'RUNNING', startedAt: T(-120), finishedAt: null, error: null });
    await f.runner.run('digest', async () => ({}), { now: T(0) });
    expect(f.runs.find((r) => r.id === 'old')).toMatchObject({ status: 'FAILED', error: 'worker stopped before finishing' });
  });
  it('status() reports last success, last run, streak and 24h failures per job', async () => {
    const f = runnerFakes();
    await f.runner.run('digest', async () => ({}), { now: T(0) });
    const st: any[] = await f.runner.status();
    expect(st.find((j) => j.job === 'digest')).toMatchObject({ lastStatus: 'OK', failureStreak: 0, failedLast24h: 0 });
    expect(st.find((j) => j.job === 'ingestion')).toMatchObject({ lastRunAt: null, lastSuccessAt: null });
  });
  it('an unreachable database makes the tick fail quietly instead of crashing the process', async () => {
    const f = runnerFakes();
    f.config.get = async () => { throw new Error('db down'); };
    expect(await f.runner.run('digest', async () => ({}), { now: T(0) })).toBe('failed');
  });
});
