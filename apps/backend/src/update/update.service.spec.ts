import { isNewer, normalizeVersion, parseReleases, resolveVersion, UpdateService } from './update.service';

describe('isNewer', () => {
  it('compares dotted versions numerically', () => {
    expect(isNewer('1.2.10', '1.2.9')).toBe(true);
    expect(isNewer('v2.0.0', '1.9.9')).toBe(true);
    expect(isNewer('1.0.0', '1.0.0')).toBe(false);
    expect(isNewer('1.0', '1.0.1')).toBe(false);
  });
});

describe('UpdateService.checkAndUpdate', () => {
  const make = (status: any) => {
    const svc: any = Object.create(UpdateService.prototype);
    svc.logger = { warn: jest.fn() };
    svc.getStatus = jest.fn().mockResolvedValue(status);
    svc.schedule = jest.fn().mockResolvedValue({});
    return svc;
  };
  const available = { latest: { available: true }, updaterConfigured: true, update: { status: 'IDLE' } };

  it('an Admin check with a newer version starts the update immediately', async () => {
    const svc = make(available);
    await svc.checkAndUpdate(true, 'admin1');
    expect(svc.schedule).toHaveBeenCalledWith(expect.any(String), 'admin1');
  });

  it.each([
    ['a non-admin', false, available],
    ['no newer version', true, { ...available, latest: { available: false } }],
    ['no updater configured', true, { ...available, updaterConfigured: false }],
    ['an update already scheduled', true, { ...available, update: { status: 'SCHEDULED' } }],
  ])('does not start an update for %s', async (_n, isAdmin, status) => {
    const svc = make(status);
    await svc.checkAndUpdate(isAdmin, 'u1');
    expect(svc.schedule).not.toHaveBeenCalled();
  });

  it('still returns the check result when the update cannot be started', async () => {
    const svc = make(available);
    svc.schedule.mockRejectedValue(new Error('refused'));
    await expect(svc.checkAndUpdate(true, 'admin1')).resolves.toBeDefined();
  });
});

describe('version handling', () => {
  it('APP_VERSION (the release the image was built from) wins over package.json, and a leading v is dropped', () => {
    expect(resolveVersion('v1.0.10', () => '1.0.0')).toBe('1.0.10');
    expect(resolveVersion('1.0.9', () => '1.0.0')).toBe('1.0.9');
  });

  it.each([undefined, '', '  ', 'latest', 'main', '1.0.0; rm -rf /'])('falls back to package.json when APP_VERSION is %p', (v) => {
    expect(resolveVersion(v as any, () => '1.0.0')).toBe('1.0.0');
  });

  it('never returns something that is not a version', () => {
    expect(resolveVersion(undefined, () => 'garbage')).toBe('0.0.0');
  });

  it.each([['v1.2.3', '1.2.3'], ['1.2', '1.2'], ['1.2.3.4', '1.2.3.4']])('accepts %s', (v, out) => expect(normalizeVersion(v)).toBe(out));
  it.each(['', 'latest', '1', '1.x', '1.0.0-rc1', '$(id)', null, 5 as any])('rejects %p', (v) => {
    expect(normalizeVersion(v as any)).toBeNull();
  });
  it('trims surrounding whitespace', () => expect(normalizeVersion(' v1.0.0 ')).toBe('1.0.0'));
});

describe('parseReleases', () => {
  const rel = (o: any = {}) => ({ tag_name: 'v1.0.10', name: 'R', body: 'notes', html_url: 'https://github.com/o/r/releases/tag/v1.0.10', published_at: '2026-10-24T00:00:00Z', draft: false, prerelease: false, ...o });

  it('keeps stable, well-formed releases and strips the v', () => {
    expect(parseReleases([rel()])).toEqual([{ version: '1.0.10', name: 'R', notes: 'notes', url: 'https://github.com/o/r/releases/tag/v1.0.10', publishedAt: '2026-10-24T00:00:00Z' }]);
  });

  it('ignores drafts, prereleases and tags that are not versions', () => {
    expect(parseReleases([rel({ draft: true }), rel({ prerelease: true }), rel({ tag_name: 'nightly' }), rel({ tag_name: '$(id)' }), null, 'x'])).toEqual([]);
  });

  it('drops a link that is not https instead of passing it on', () => {
    expect(parseReleases([rel({ html_url: 'javascript:alert(1)' })])[0].url).toBe('');
    expect(parseReleases([rel({ html_url: 'http://example.test/x' })])[0].url).toBe('');
  });

  it('refuses a body that is not a list (malformed answer)', () => {
    expect(() => parseReleases({ message: 'Not Found' })).toThrow();
    expect(() => parseReleases(null)).toThrow();
  });
});

describe('update lifecycle', () => {
  const make = (state: any, version: string) => {
    const store: { state: any } = { state };
    const prisma: any = {
      appSettings: {
        findUnique: jest.fn(async () => (store.state ? { data: store.state } : null)),
        upsert: jest.fn(async ({ update }: any) => { store.state = update.data; }),
      },
    };
    const redis: any = { del: jest.fn(), set: jest.fn().mockResolvedValue('OK') };
    const notifications: any = { notifyAllActiveUsers: jest.fn() };
    const svc: any = new UpdateService(prisma, redis, notifications);
    (svc as any).version = version;
    return { svc, store, redis, notifications };
  };

  it('after a restart, an IN_PROGRESS update whose version changed is COMPLETED and the lock is released', async () => {
    const { svc, store, redis } = make({ status: 'IN_PROGRESS', fromVersion: '1.0.9', targetVersion: '1.0.10', startedAt: new Date().toISOString() }, '1.0.10');
    await svc.onModuleInit();
    expect(store.state.status).toBe('COMPLETED');
    expect(redis.del).toHaveBeenCalled();
  });

  it('an IN_PROGRESS update whose version did NOT change stays running until the timeout, then FAILED', async () => {
    const recent = make({ status: 'IN_PROGRESS', fromVersion: '1.0.9', startedAt: new Date().toISOString() }, '1.0.9');
    await recent.svc.onModuleInit();
    expect(recent.store.state.status).toBe('IN_PROGRESS');
    const old = make({ status: 'IN_PROGRESS', fromVersion: '1.0.9', startedAt: new Date(Date.now() - 2 * 3600_000).toISOString() }, '1.0.9');
    await old.svc.onModuleInit();
    expect(old.store.state.status).toBe('FAILED');
  });

  describe('schedule', () => {
    const OLD = process.env.UPDATE_COMMAND;
    afterEach(() => { if (OLD === undefined) delete process.env.UPDATE_COMMAND; else process.env.UPDATE_COMMAND = OLD; });
    const newer = { latest: { available: true, version: '1.0.10' } };

    it('refuses when no updater is configured, and when the command looks destructive', async () => {
      const { svc } = make({ status: 'IDLE' }, '1.0.9');
      delete process.env.UPDATE_COMMAND;
      await expect(svc.schedule(new Date().toISOString(), 'a')).rejects.toThrow(/No updater/);
      process.env.UPDATE_COMMAND = 'npx prisma migrate reset --force';
      await expect(svc.schedule(new Date().toISOString(), 'a')).rejects.toThrow(/destructive/);
      process.env.UPDATE_COMMAND = 'docker compose exec backend npx prisma db seed';
      await expect(svc.schedule(new Date().toISOString(), 'a')).rejects.toThrow(/destructive/);
    });

    it('refuses a bad or past date, a second update, and "nothing newer"', async () => {
      process.env.UPDATE_COMMAND = 'echo ok';
      const { svc } = make({ status: 'IDLE' }, '1.0.9');
      await expect(svc.schedule('nope', 'a')).rejects.toThrow(/valid date/);
      await expect(svc.schedule(new Date(Date.now() - 3600_000).toISOString(), 'a')).rejects.toThrow(/past/);
      svc.getStatus = jest.fn().mockResolvedValue({ latest: { available: false } });
      await expect(svc.schedule(new Date().toISOString(), 'a')).rejects.toThrow(/No newer/);
      const busy = make({ status: 'IN_PROGRESS' }, '1.0.9');
      await expect(busy.svc.schedule(new Date().toISOString(), 'a')).rejects.toThrow(/already/);
    });

    it('records the target and source version, and the shell command never receives the release text', async () => {
      process.env.UPDATE_COMMAND = 'echo updating';
      const { svc, store } = make({ status: 'IDLE' }, '1.0.9');
      svc.getStatus = jest.fn().mockResolvedValue(newer);
      const out = await svc.schedule(new Date().toISOString(), 'admin1');
      expect(out).toMatchObject({ status: 'SCHEDULED', targetVersion: '1.0.10', fromVersion: '1.0.9', scheduledBy: 'admin1' });
      expect(store.state.status).toBe('SCHEDULED');
      const exec = jest.spyOn(svc as any, 'exec').mockResolvedValue('');
      store.state = { ...store.state, scheduledAt: new Date(Date.now() - 1000).toISOString() };
      await svc.tick();
      expect(exec).toHaveBeenCalledTimes(1);
      expect(exec).toHaveBeenCalledWith('echo updating'); // exactly the operator's command; no version or URL appended
      expect(store.state.status).toBe('COMPLETED');
    });

    it('a failing command marks the update FAILED without leaking its output', async () => {
      process.env.UPDATE_COMMAND = 'false';
      const { svc, store } = make({ status: 'SCHEDULED', scheduledAt: new Date(Date.now() - 1000).toISOString(), targetVersion: '1.0.10', fromVersion: '1.0.9' }, '1.0.9');
      jest.spyOn(svc as any, 'exec').mockResolvedValue('Update command exited with code 1 (see server logs)');
      await svc.tick();
      expect(store.state.status).toBe('FAILED');
      const status = await svc.getStatus.call({ ...svc, getState: () => store.state, fetchReleases: async () => ({ releases: [], changelog: '' }), version: '1.0.9' }, false, false);
      expect(status.update.scheduledBy).toBeUndefined();
      expect(status.update.error).toBe('Update failed');
    });
  });
});
