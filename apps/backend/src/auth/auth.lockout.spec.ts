import { ForbiddenException, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AdminOnlyGuard } from './guards/admin-only.guard';
import { IS_PUBLIC_KEY } from './decorators/roles.decorator';
import { UsersController } from '../users/users.controller';
import { RIGHT, WRONG, T0, actions, build, clock, useClock } from './lockout.test-helpers';

jest.mock('argon2', () => {
  const real = jest.requireActual('argon2');
  return { ...real, verify: jest.fn(real.verify) };
});
jest.setTimeout(60_000);

const verifySpy = argon2.verify as unknown as jest.Mock;
const fail = (auth: any, user = 'alice', pw = WRONG) => auth.validateUser(user, pw, '1.2.3.4', 'jest').then(() => 'ok', (e: any) => e.message as string);
const failN = async (auth: any, n: number, user = 'alice') => { for (let i = 0; i < n; i++) await fail(auth, user); };

beforeEach(() => { clock.now = T0; useClock(); verifySpy.mockClear(); });
afterEach(() => jest.restoreAllMocks());

describe('a user becoming temporarily locked', () => {
  it('is locked on the configured failed attempt, with a server-generated start and expiry exactly one duration later', async () => {
    const { auth, locks, audit } = await build({ maxAttempts: 5, durationMinutes: 15 });
    await failN(auth, 4);
    expect(await locks.getActive('u1')).toBeNull();
    expect(await fail(auth)).toMatch(/temporarily locked/);
    const lock = (await locks.getActive('u1'))!;
    expect(lock.lockedAt).toBe(new Date(T0).toISOString());
    expect(Date.parse(lock.expiresAt) - Date.parse(lock.lockedAt)).toBe(15 * 60_000);
    expect(lock.reason).toBe('TOO_MANY_FAILED_LOGINS');
    expect(actions(audit).filter((a: string) => a === 'ACCOUNT_LOCKED')).toHaveLength(1);
  });

  it('rejects even the correct password while locked, and never runs the account\'s own hash check', async () => {
    const { auth, users } = await build();
    await failN(auth, 5);
    verifySpy.mockClear();
    expect(await fail(auth, 'alice', RIGHT)).toMatch(/temporarily locked/);
    expect(verifySpy.mock.calls.filter((c) => c[0] === users[0].passwordHash)).toHaveLength(0);
  });

  it('does not tell a locked account apart from a name that does not exist (same message, same hashing work)', async () => {
    const { auth } = await build();
    await failN(auth, 5);
    const real = await fail(auth, 'alice');
    await failN(auth, 4, 'ghost');
    const ghost = await fail(auth, 'ghost');
    expect(real).toBe(ghost);
    expect(real).toMatch(/up to 15 minutes/);
  });
});

describe('expiry', () => {
  it('lets the user in again after the lock period, with no action from anyone, and audits the expiry once', async () => {
    const { auth, locks, audit } = await build({ maxAttempts: 3, durationMinutes: 10 });
    await failN(auth, 3);
    clock.now = T0 + 10 * 60_000 - 1;
    expect(await fail(auth, 'alice', RIGHT)).toMatch(/temporarily locked/); // one ms early: still locked
    clock.now = T0 + 10 * 60_000;
    expect(await fail(auth, 'alice', RIGHT)).toBe('ok'); // the password is still checked, and is right
    expect(await locks.getActive('u1')).toBeNull();
    expect(actions(audit).filter((a: string) => a === 'ACCOUNT_LOCK_EXPIRED')).toHaveLength(1);
  });

  it('the background sweep records the expiry even if nobody signs in or has the page open', async () => {
    const { locks, auth, audit, redis } = await build({ maxAttempts: 3, durationMinutes: 10 });
    await failN(auth, 3);
    await locks.sweepExpired();
    expect(redis.locks.size).toBe(1); // not expired yet
    clock.now = T0 + 11 * 60_000;
    await locks.sweepExpired();
    await locks.sweepExpired(); // a second sweep must not audit again
    expect(redis.locks.size).toBe(0);
    expect(actions(audit).filter((a: string) => a === 'ACCOUNT_LOCK_EXPIRED')).toHaveLength(1);
    const expired = audit.log.mock.calls.map((c: any) => c[0]).find((e: any) => e.action === 'ACCOUNT_LOCK_EXPIRED');
    expect(expired).toMatchObject({ targetUserId: 'u1', details: { reason: 'TOO_MANY_FAILED_LOGINS' } });
  });

  it('after expiry the user gets a full set of attempts again', async () => {
    const { auth, locks } = await build({ maxAttempts: 3, durationMinutes: 10 });
    await failN(auth, 3);
    clock.now = T0 + 10 * 60_000;
    await failN(auth, 2);
    expect(await locks.getActive('u1')).toBeNull();
    expect(await fail(auth)).toMatch(/temporarily locked/);
  });
});

describe('configuration changes', () => {
  it('apply to the next lock; an existing lock keeps its own expiry', async () => {
    const { auth, locks, policy } = await build({ maxAttempts: 3, durationMinutes: 10 });
    await failN(auth, 3);
    const before = (await locks.getActive('u1'))!;
    policy.durationMinutes = 120;
    policy.maxAttempts = 20;
    expect((await locks.getActive('u1'))!.expiresAt).toBe(before.expiresAt);
    const second = await locks.lock({ id: 'adm', username: 'root' }, 20, policy.durationMinutes, 'ip', 'ua');
    expect(second).toBeUndefined();
    const adm = (await locks.getActive('adm'))!;
    expect(Date.parse(adm.expiresAt) - Date.parse(adm.lockedAt)).toBe(120 * 60_000);
  });
});

describe('concurrent attempts during lockout', () => {
  it('a burst of parallel guesses is cut off at the limit: at most maxAttempts password checks, one lock, one audit entry', async () => {
    const { auth, locks, audit, users } = await build({ maxAttempts: 5, durationMinutes: 15 });
    const results = await Promise.all(Array.from({ length: 40 }, () => fail(auth)));
    const checks = verifySpy.mock.calls.filter((c) => c[0] === users[0].passwordHash).length;
    expect(checks).toBeLessThanOrEqual(5);
    expect(results.filter((m) => /temporarily locked/.test(m)).length).toBeGreaterThanOrEqual(35);
    expect(await locks.getActive('u1')).not.toBeNull();
    expect(actions(audit).filter((a: string) => a === 'ACCOUNT_LOCKED')).toHaveLength(1);
  });

  it('a correct password that arrives after the limit was used up does not get through', async () => {
    const { auth } = await build({ maxAttempts: 3, durationMinutes: 15 });
    const results = await Promise.all([fail(auth), fail(auth), fail(auth), fail(auth, 'alice', RIGHT), fail(auth, 'alice', RIGHT)]);
    expect(results.slice(3)).toEqual([expect.stringMatching(/temporarily locked/), expect.stringMatching(/temporarily locked/)]);
  });
});

describe('Admin list and unlock', () => {
  it('lists only accounts that are locked now, with the fields an Admin needs and no credentials', async () => {
    const { auth, locks } = await build({ maxAttempts: 3, durationMinutes: 10 });
    await failN(auth, 3);
    const { locks: list, serverTime } = await locks.listActive();
    expect(serverTime).toBe(new Date(T0).toISOString());
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ userId: 'u1', username: 'alice', fullName: 'Alice A', email: 'alice@x.com', role: 'TESTER', status: 'LOCKED', reason: 'TOO_MANY_FAILED_LOGINS' });
    expect(Object.keys(list[0]).join()).not.toMatch(/password|hash|token|secret/i);
    clock.now = T0 + 10 * 60_000;
    expect((await locks.listActive()).locks).toHaveLength(0);
  });

  it('unlock removes the lock at once, audits the administrator, and still requires the password', async () => {
    const { auth, locks, audit } = await build({ maxAttempts: 3, durationMinutes: 10 });
    await failN(auth, 3);
    await expect(locks.unlock('u1', 'adm', '9.9.9.9', 'jest-admin')).resolves.toEqual({ userId: 'u1', status: 'UNLOCKED' });
    expect((await locks.listActive()).locks).toHaveLength(0);
    const entry = audit.log.mock.calls.map((c: any) => c[0]).find((e: any) => e.action === 'ACCOUNT_UNLOCKED');
    expect(entry).toMatchObject({ actorId: 'adm', targetUserId: 'u1', ipAddress: '9.9.9.9', details: { username: 'alice' } });
    expect(JSON.stringify(entry)).not.toMatch(/password|hash|token/i);
    expect(await fail(auth, 'alice', WRONG)).toBe('Invalid credentials'); // wrong password is still refused (and counted from zero)
    expect(await fail(auth, 'alice', RIGHT)).toBe('ok');
  });

  it('unlocking an account that is not locked (or whose lock ran out) is a 404 and audits nothing', async () => {
    const { locks, audit } = await build();
    await expect(locks.unlock('u1', 'adm', 'ip', 'ua')).rejects.toThrow(NotFoundException);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('two Admins unlocking at the same moment: one succeeds, one audit entry', async () => {
    const { auth, locks, audit } = await build({ maxAttempts: 3, durationMinutes: 10 });
    await failN(auth, 3);
    const r = await Promise.allSettled([locks.unlock('u1', 'adm', 'ip', 'ua'), locks.unlock('u1', 'adm', 'ip', 'ua')]);
    expect(r.map((x) => x.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(actions(audit).filter((a: string) => a === 'ACCOUNT_UNLOCKED')).toHaveLength(1);
  });
});

describe('only Admins reach the lock list and the unlock action', () => {
  const guard = new AdminOnlyGuard();
  const ctx = (role: string | null) => ({ switchToHttp: () => ({ getRequest: () => ({ user: role ? { role } : undefined }) }) }) as any;

  it.each(['listLocked', 'unlock'])('%s is behind the Admin-only guard and is not public', (name) => {
    const handler = (UsersController.prototype as any)[name];
    expect(Reflect.getMetadata('__guards__', handler)).toContain(AdminOnlyGuard);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, UsersController)).toBeUndefined();
  });

  it.each(['AVP', 'TEAM_LEAD', 'TESTER', 'SOMETHING_ELSE'])('refuses %s, whatever the RBAC matrix says (it cannot be delegated)', (role) => {
    expect(() => guard.canActivate(ctx(role))).toThrow(ForbiddenException);
  });

  it('refuses a request with no user, and lets an Admin through', () => {
    expect(() => guard.canActivate(ctx(null))).toThrow(ForbiddenException);
    expect(guard.canActivate(ctx('ADMIN'))).toBe(true);
  });
});

describe('existing sign-in behaviour is unchanged', () => {
  it('a normal sign-in succeeds, resets the counter, and leaves no lock', async () => {
    const { auth, redis, locks } = await build();
    await failN(auth, 2);
    const result = await auth.validateUser('alice', RIGHT, 'ip', 'ua');
    expect(result.user.username).toBe('alice');
    expect(redis.counters.has('alice')).toBe(false);
    expect(await locks.getActive('u1')).toBeNull();
  });

  it('a wrong password is still "Invalid credentials" below the limit, and unknown names behave the same', async () => {
    const { auth } = await build();
    expect(await fail(auth)).toBe('Invalid credentials');
    expect(await fail(auth, 'ghost')).toBe('Invalid credentials');
  });

  it('a disabled account gets the same answers as an unknown one', async () => {
    const { auth, users } = await build({ maxAttempts: 3, durationMinutes: 10 });
    users[0].isActive = false;
    expect(await fail(auth, 'alice', RIGHT)).toBe('Invalid credentials');
    await failN(auth, 1, 'alice');
    expect(await fail(auth, 'alice')).toMatch(/temporarily locked/);
  });
});

describe('invalid or missing configuration cannot weaken the protection', () => {
  it('uses the safe defaults when the stored policy is missing', async () => {
    const { auth, settings } = await build();
    settings.getLockoutPolicy.mockImplementation(async () => ({ maxAttempts: 5, durationMinutes: 15 }));
    await failN(auth, 4);
    expect(await fail(auth)).toMatch(/temporarily locked/);
  });
});
