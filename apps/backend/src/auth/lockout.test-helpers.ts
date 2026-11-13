// Shared fakes for the lockout specs: an in-memory stand-in for the Redis calls the lock logic uses (each call is atomic, as in Redis),
// and a clock the tests can move.
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { AccountLockService } from './account-lock.service';

export class FakeRedis {
  counters = new Map<string, number>();
  windows = new Map<string, number>();
  locks = new Map<string, string>();
  async incrementLoginAttempts(username: string, windowSeconds = 900) {
    const n = (this.counters.get(username) ?? 0) + 1;
    this.counters.set(username, n);
    if (n === 1) this.windows.set(username, windowSeconds);
    return n;
  }
  async restartLoginAttemptsWindow(username: string, windowSeconds: number) {
    this.windows.set(username, windowSeconds);
  }
  async resetLoginAttempts(username: string) {
    this.counters.delete(username);
  }
  async createAccountLock(userId: string, record: string) {
    if (this.locks.has(userId)) return false;
    this.locks.set(userId, record);
    return true;
  }
  async getAccountLock(userId: string) {
    return this.locks.get(userId) ?? null;
  }
  async deleteAccountLock(userId: string) {
    return this.locks.delete(userId);
  }
  async listAccountLocks() {
    return [...this.locks.values()];
  }
  // session helpers used when a sign-in succeeds
  async storeRefreshToken() {}
  async setActiveSession() {}
  async touchSessionActivity() {}
}

export const T0 = Date.parse('2026-11-12T10:00:00.000Z');
export const clock = { now: T0 };
export const useClock = () => jest.spyOn(Date, 'now').mockImplementation(() => clock.now);

export async function build(policy = { maxAttempts: 5, durationMinutes: 15 }) {
  const passwordHash = await argon2.hash('Correct-Passw0rd!x1', { type: argon2.argon2id, memoryCost: 4096, timeCost: 2, parallelism: 1 });
  const users: any[] = [
    { id: 'u1', username: 'alice', email: 'alice@x.com', fullName: 'Alice A', role: 'TESTER', isActive: true, passwordHash, assignedTlId: null, isForcePasswordChange: false },
    { id: 'adm', username: 'root', email: 'root@x.com', fullName: 'Root', role: 'ADMIN', isActive: true, passwordHash, assignedTlId: null, isForcePasswordChange: false },
  ];
  const prisma: any = {
    user: {
      findUnique: jest.fn(async ({ where }: any) => users.find((u) => (where.id ? u.id === where.id : where.username ? u.username === where.username : u.email === where.email)) ?? null),
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async ({ where }: any) => users.filter((u) => where.id.in.includes(u.id))),
      update: jest.fn(async () => ({})),
    },
  };
  const redis = new FakeRedis();
  const audit = { log: jest.fn(async () => undefined) };
  const currentPolicy = { ...policy };
  const settings: any = {
    getLockoutPolicy: jest.fn(async () => ({ ...currentPolicy })),
    get: jest.fn(async () => ({ settings: { security: { sessionTimeoutMinutes: 15 } } })),
  };
  const locks = new AccountLockService(redis as any, prisma, audit as any);
  const jwt: any = { sign: jest.fn().mockReturnValue('signed') };
  const auth = new AuthService(prisma, jwt, redis as any, { get: jest.fn() } as any, audit as any, settings, locks);
  return { auth, locks, redis, audit, prisma, settings, policy: currentPolicy, users };
}

export const WRONG = 'Wrong-Passw0rd!';
export const RIGHT = 'Correct-Passw0rd!x1';
export const actions = (audit: { log: jest.Mock }) => audit.log.mock.calls.map((c: any[]) => c[0].action);
