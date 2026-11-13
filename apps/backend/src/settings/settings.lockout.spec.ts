import { SettingsService } from './settings.service';
import { DEFAULT_SETTINGS, LOCKOUT_LIMITS } from './settings.defaults';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { SettingsController } from './settings.controller';

// A tiny stand-in for the app_settings table, so "restart" can be simulated by building a second service over the same rows.
function makeStore(initial: any = null) {
  let row: any = initial ? { id: 'singleton', data: initial, updatedAt: new Date(), updatedById: null } : null;
  const prisma: any = {
    appSettings: {
      findUnique: jest.fn(async () => row),
      upsert: jest.fn(async (a: any) => { row = { id: 'singleton', data: a.create.data ?? a.update.data, updatedAt: new Date(), updatedById: a.create.updatedById }; return row; }),
    },
  };
  const audit = { log: jest.fn(async () => undefined) };
  const make = () => new SettingsService(prisma, audit as any, {} as any, { resetUsage: jest.fn() } as any);
  return { prisma, audit, make, rows: () => row };
}

describe('lockout settings: validation', () => {
  const bad: [string, any][] = [
    ['zero attempts (would lock on the first try)', { lockoutMaxAttempts: 0 }],
    ['one attempt', { lockoutMaxAttempts: 1 }],
    ['below the minimum', { lockoutMaxAttempts: LOCKOUT_LIMITS.maxAttempts.min - 1 }],
    ['above the maximum', { lockoutMaxAttempts: LOCKOUT_LIMITS.maxAttempts.max + 1 }],
    ['a huge number (would effectively disable the limit)', { lockoutMaxAttempts: 1e9 }],
    ['negative', { lockoutMaxAttempts: -5 }],
    ['a fraction', { lockoutMaxAttempts: 5.5 }],
    ['text', { lockoutMaxAttempts: '5' }],
    ['null', { lockoutMaxAttempts: null }],
    ['NaN', { lockoutMaxAttempts: NaN }],
    ['zero minutes (a lock that never holds)', { lockoutDurationMinutes: 0 }],
    ['a duration above the maximum (could lock every admin out for days)', { lockoutDurationMinutes: LOCKOUT_LIMITS.durationMinutes.max + 1 }],
    ['a fractional duration', { lockoutDurationMinutes: 1.5 }],
    ['an object', { lockoutDurationMinutes: { a: 1 } }],
  ];

  it.each(bad)('refuses %s and stores nothing', async (_name, security) => {
    const { make, prisma } = makeStore();
    await expect(make().update({ security }, 'admin', 'ip', 'ua')).rejects.toThrow(/lockout/);
    expect(prisma.appSettings.upsert).not.toHaveBeenCalled();
  });

  it('accepts the limits themselves and values in between', async () => {
    const { make } = makeStore();
    for (const security of [
      { lockoutMaxAttempts: LOCKOUT_LIMITS.maxAttempts.min, lockoutDurationMinutes: LOCKOUT_LIMITS.durationMinutes.min },
      { lockoutMaxAttempts: LOCKOUT_LIMITS.maxAttempts.max, lockoutDurationMinutes: LOCKOUT_LIMITS.durationMinutes.max },
      { lockoutMaxAttempts: 7, lockoutDurationMinutes: 30 },
    ]) await expect(make().update({ security }, 'admin', 'ip', 'ua')).resolves.toBeDefined();
  });

  it('the defaults themselves are inside the limits', () => {
    expect(DEFAULT_SETTINGS.security.lockoutMaxAttempts).toBeGreaterThanOrEqual(LOCKOUT_LIMITS.maxAttempts.min);
    expect(DEFAULT_SETTINGS.security.lockoutMaxAttempts).toBeLessThanOrEqual(LOCKOUT_LIMITS.maxAttempts.max);
    expect(DEFAULT_SETTINGS.security.lockoutDurationMinutes).toBe(15);
  });
});

describe('lockout settings: persistence, effect and audit', () => {
  it('survive a restart (a new service over the same stored rows) and are what the next lock uses', async () => {
    const { make, rows } = makeStore();
    await make().update({ security: { lockoutMaxAttempts: 8, lockoutDurationMinutes: 45 } }, 'admin', 'ip', 'ua');
    expect(rows().data.security).toMatchObject({ lockoutMaxAttempts: 8, lockoutDurationMinutes: 45 });
    const afterRestart = make();
    expect(await afterRestart.getLockoutPolicy()).toEqual({ maxAttempts: 8, durationMinutes: 45 });
    expect((await afterRestart.get()).settings.security).toMatchObject({ lockoutMaxAttempts: 8, lockoutDurationMinutes: 45 }); // what the Settings page shows
  });

  it('a change is audited with the administrator and the changed values (no secrets involved)', async () => {
    const { make, audit } = makeStore();
    await make().update({ security: { lockoutMaxAttempts: 6 } }, 'admin-1', '1.1.1.1', 'jest');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'admin-1', action: 'SETTINGS_UPDATED', ipAddress: '1.1.1.1', details: { changed: { security: { lockoutMaxAttempts: 6 } } } }));
  });

  it('a partial update leaves the other lockout value as it was', async () => {
    const { make } = makeStore();
    await make().update({ security: { lockoutMaxAttempts: 9, lockoutDurationMinutes: 60 } }, 'a', 'ip', 'ua');
    await make().update({ security: { lockoutMaxAttempts: 4 } }, 'a', 'ip', 'ua');
    expect(await make().getLockoutPolicy()).toEqual({ maxAttempts: 4, durationMinutes: 60 });
  });
});

describe('lockout settings: invalid or missing stored configuration cannot weaken the protection', () => {
  it.each([
    ['nothing saved', null],
    ['no security block', { general: {} }],
    ['zero attempts stored directly in the database', { security: { lockoutMaxAttempts: 0, lockoutDurationMinutes: 0 } }],
    ['garbage types', { security: { lockoutMaxAttempts: 'x', lockoutDurationMinutes: { a: 1 } } }],
    ['absurd values', { security: { lockoutMaxAttempts: 1e12, lockoutDurationMinutes: -1 } }],
  ])('falls back to the safe defaults for: %s', async (_n, stored) => {
    const { make } = makeStore(stored);
    expect(await make().getLockoutPolicy()).toEqual({ maxAttempts: LOCKOUT_LIMITS.maxAttempts.fallback, durationMinutes: LOCKOUT_LIMITS.durationMinutes.fallback });
  });

  it('falls back when the settings cannot be read at all', async () => {
    const { make, prisma } = makeStore();
    prisma.appSettings.findUnique.mockRejectedValue(new Error('db down'));
    expect(await make().getLockoutPolicy()).toEqual({ maxAttempts: 5, durationMinutes: 15 });
  });

  it('an unusable MAX_LOGIN_ATTEMPTS environment value cannot become the default', () => {
    const saved = process.env.MAX_LOGIN_ATTEMPTS;
    try {
      for (const v of ['0', '1', '-3', 'abc', '99999', '']) {
        process.env.MAX_LOGIN_ATTEMPTS = v;
        let d: any;
        jest.isolateModules(() => { d = require('./settings.defaults').DEFAULT_SETTINGS; });
        expect(d.security.lockoutMaxAttempts).toBe(5);
      }
      process.env.MAX_LOGIN_ATTEMPTS = '8';
      jest.isolateModules(() => { expect(require('./settings.defaults').DEFAULT_SETTINGS.security.lockoutMaxAttempts).toBe(8); }); // existing installs keep theirs
    } finally {
      if (saved === undefined) delete process.env.MAX_LOGIN_ATTEMPTS; else process.env.MAX_LOGIN_ATTEMPTS = saved;
    }
  });
});

describe('only Admins change the settings', () => {
  it('PUT /settings is restricted to the ADMIN role', () => {
    expect(Reflect.getMetadata(ROLES_KEY, SettingsController.prototype.update)).toEqual(['ADMIN']);
  });
});
