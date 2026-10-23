import 'reflect-metadata';
import { UserRole } from '@prisma/client';
import { PresenceService } from './presence.service';
import { PresenceController } from './presence.controller';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';

const NOW = 1_800_000_000_000;

/** Redis stub: `seen` is the sorted set; `sessions` maps userId -> sessionId; `alive` are the live session_activity keys. */
function setup(opts: { seen: Record<string, number>; sessions?: Record<string, string>; alive?: string[]; db?: any[]; minutes?: string; managedBy?: Record<string, string[]> }) {
  const sessions = opts.sessions ?? Object.fromEntries(Object.keys(opts.seen).map((id) => [id, `s-${id}`]));
  const alive = new Set(opts.alive ?? Object.values(sessions));
  const redis: any = {
    zadd: jest.fn().mockResolvedValue(1),
    zrangebyscore: jest.fn(async (_k: string, min: number) => Object.entries(opts.seen).filter(([, t]) => t >= min).flatMap(([id, t]) => [id, String(t)])),
    zremrangebyscore: jest.fn().mockResolvedValue(0),
    mget: jest.fn(async (keys: string[]) => keys.map((k) => sessions[k.replace('active_session:', '')] ?? null)),
    pipeline: jest.fn(() => {
      const keys: string[] = [];
      const p: any = { exists: (k: string) => { keys.push(k); return p; }, exec: async () => keys.map((k) => [null, alive.has(k.replace('session_activity:', '')) ? 1 : 0]) };
      return p;
    }),
  };
  const row = (id: string, over: any = {}) => ({ id, username: id, fullName: id.toUpperCase(), role: UserRole.TESTER, assignedTlId: 'tl1', assignedTl: { fullName: 'Team Lead', username: 'tl1' }, ...over });
  const prisma: any = {
    user: {
      findMany: jest.fn(async ({ where }: any) => {
        if (where.managerId) return (opts.managedBy?.[where.managerId] ?? []).map((id) => ({ id })); // Team Leads reporting to this AVP
        return (opts.db ?? Object.keys(opts.seen).map((id) => row(id))).filter((u) => where.id.in.includes(u.id));
      }),
    },
  };
  const config: any = { get: jest.fn(() => opts.minutes) };
  return { svc: new PresenceService(redis, prisma, config), redis, prisma };
}

describe('PresenceService', () => {
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(NOW));
  afterEach(() => jest.restoreAllMocks());

  it('counts a user once however many tabs or pings: presence is one entry per user id', async () => {
    const { svc, redis } = setup({ seen: { u1: NOW - 1000 } });
    await svc.heartbeat('u1');
    await svc.heartbeat('u1');
    expect(redis.zadd).toHaveBeenCalledTimes(2);
    expect(redis.zadd).toHaveBeenCalledWith('presence:last_seen', NOW, 'u1'); // same member, so it only moves forward
    expect(await svc.count()).toBe(1);
  });

  it('excludes users idle past the threshold (default 5 minutes) and honours the configured one', async () => {
    const seen = { fresh: NOW - 60_000, stale: NOW - 6 * 60_000 };
    expect(await setup({ seen }).svc.count()).toBe(1);
    expect(await setup({ seen, minutes: '10' }).svc.count()).toBe(2);
    expect(await setup({ seen, minutes: '1' }).svc.count()).toBe(1); // below the 2-minute floor falls back to the default
  });

  it('idle users (signed in, no activity past the threshold) are listed as IDLE but never counted', async () => {
    const { svc } = setup({ seen: { active: NOW - 60_000, idle: NOW - 12 * 60_000 } });
    expect(await svc.count()).toBe(1);
    const list = await svc.listFor({ id: 'a', role: UserRole.ADMIN });
    expect(list.map((u) => [u.id, u.status])).toEqual([['active', 'ACTIVE'], ['idle', 'IDLE']]); // active first
  });

  it('idle users stay listed for hours while their session lasts, and are dropped after a day', async () => {
    const { svc, redis } = setup({ seen: { longIdle: NOW - 3 * 60 * 60 * 1000 } });
    expect((await svc.listFor({ id: 'a', role: UserRole.ADMIN })).map((u) => u.id)).toEqual(['longIdle']);
    expect(redis.zrangebyscore.mock.calls[0][1]).toBe(NOW - 24 * 60 * 60 * 1000); // nothing older is read
    expect(redis.zremrangebyscore).toHaveBeenCalledWith('presence:last_seen', '-inf', NOW - 24 * 60 * 60 * 1000);
  });

  it('an idle user who has logged out or whose session expired is not listed at all', async () => {
    const { svc } = setup({ seen: { idleIn: NOW - 20 * 60_000, idleOut: NOW - 20 * 60_000 }, sessions: { idleIn: 'a' }, alive: ['a'] });
    expect((await svc.listFor({ id: 'x', role: UserRole.ADMIN })).map((u) => u.id)).toEqual(['idleIn']);
  });

  it('excludes logged-out and expired sessions without any change to login/logout', async () => {
    const { svc } = setup({
      seen: { in: NOW - 1000, loggedOut: NOW - 1000, expired: NOW - 1000 },
      sessions: { in: 'a', expired: 'b' }, // loggedOut has no active_session pointer
      alive: ['a'], // 'b' idle-expired: its session_activity key is gone
    });
    expect((await svc.listFor({ id: 'x', role: UserRole.ADMIN })).map((u) => u.id)).toEqual(['in']);
  });

  it('excludes disabled and deleted accounts (filtered by the database query)', async () => {
    const { svc, prisma } = setup({ seen: { u1: NOW - 1000 } });
    await svc.count();
    expect(prisma.user.findMany.mock.calls[0][0].where).toMatchObject({ isActive: true, deletedAt: null });
  });

  it('a user appears in the very next count after their first heartbeat', async () => {
    const { svc } = setup({ seen: { a: NOW - 1000 } });
    expect(await svc.count()).toBe(1); // snapshot cached
    await svc.heartbeat('b'); // not in the snapshot -> cache dropped
    expect((svc as any).cache).toBeNull();
  });

  it('computes the live set once for many concurrent readers (short cache)', async () => {
    const { svc, redis, prisma } = setup({ seen: { a: NOW - 1000, b: NOW - 2000 } });
    await Promise.all([svc.count(), svc.count(), svc.listFor({ id: 'a', role: UserRole.ADMIN }), svc.count()]);
    await svc.count();
    expect(redis.zrangebyscore).toHaveBeenCalledTimes(1);
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
  });

  describe('listFor: role scoping', () => {
    const db = [
      { id: 'admin', username: 'admin', fullName: 'Admin', role: UserRole.ADMIN, assignedTlId: null, assignedTl: null },
      { id: 'tl1', username: 'tl1', fullName: 'TL One', role: UserRole.TEAM_LEAD, assignedTlId: null, assignedTl: null },
      { id: 't1', username: 't1', fullName: 'Tester 1', role: UserRole.TESTER, assignedTlId: 'tl1', assignedTl: { fullName: 'TL One', username: 'tl1' } },
      { id: 't2', username: 't2', fullName: 'Tester 2', role: UserRole.TESTER, assignedTlId: 'tl2', assignedTl: { fullName: 'TL Two', username: 'tl2' } },
    ];
    const seen = { admin: NOW - 1, tl1: NOW - 2, t1: NOW - 3, t2: NOW - 4 };
    const ids = async (caller: any) => (await setup({ seen, db }).svc.listFor(caller)).map((u) => u.id);

    it('Admin sees everyone, newest activity first', async () => {
      expect(await ids({ id: 'admin', role: UserRole.ADMIN })).toEqual(['admin', 'tl1', 't1', 't2']);
    });
    it('Team Lead sees only their own team plus themselves', async () => {
      expect(await ids({ id: 'tl1', role: UserRole.TEAM_LEAD })).toEqual(['tl1', 't1']);
    });
    it('AVP sees themselves, the Team Leads who report to them and every team under those Team Leads, but not other teams', async () => {
      const full = [
        { id: 'avp', username: 'avp', fullName: 'AVP', role: UserRole.AVP, assignedTlId: null, assignedTl: null },
        ...db,
        { id: 'tl2', username: 'tl2', fullName: 'TL Two', role: UserRole.TEAM_LEAD, assignedTlId: null, assignedTl: null },
        { id: 'other', username: 'other', fullName: 'Other', role: UserRole.TESTER, assignedTlId: 'tl9', assignedTl: { fullName: 'TL Nine', username: 'tl9' } },
      ];
      const all = { ...seen, avp: NOW - 5, tl2: NOW - 6, other: NOW - 7 };
      const ids = (await setup({ seen: all, db: full, managedBy: { avp: ['tl1', 'tl2'] } }).svc.listFor({ id: 'avp', role: UserRole.AVP })).map((u) => u.id);
      expect(ids.sort()).toEqual(['avp', 't1', 't2', 'tl1', 'tl2']); // t2 is on tl2; 'admin' and 'other' (tl9's tester) are outside
    });
    it('an AVP with no Team Leads under them sees only themselves and anyone assigned to them directly', async () => {
      const full = [{ id: 'avp', username: 'avp', fullName: 'AVP', role: UserRole.AVP, assignedTlId: null, assignedTl: null }, ...db];
      expect((await setup({ seen: { ...seen, avp: NOW - 5 }, db: full }).svc.listFor({ id: 'avp', role: UserRole.AVP })).map((u) => u.id)).toEqual(['avp']);
    });
    it('Tester gets nothing even if called directly', async () => {
      expect(await ids({ id: 't1', role: UserRole.TESTER })).toEqual([]);
    });
    it('exposes the team lead name and last activity, and nothing like tokens, sessions or IPs', async () => {
      const [u] = await setup({ seen, db }).svc.listFor({ id: 'admin', role: UserRole.ADMIN });
      expect(Object.keys(u).sort()).toEqual(['assignedTlId', 'fullName', 'id', 'lastActiveAt', 'role', 'status', 'teamLeadName', 'username']);
    });
  });
});

describe('PresenceController', () => {
  it('the user list is restricted to Admin, Team Lead and AVP at the route (global RolesGuard enforces it)', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, PresenceController.prototype.activeUsers);
    expect(roles.sort()).toEqual([UserRole.ADMIN, UserRole.AVP, UserRole.TEAM_LEAD].sort());
    expect(roles).not.toContain(UserRole.TESTER);
  });

  it('the count endpoint carries no role restriction and returns only a number plus the threshold', async () => {
    expect(Reflect.getMetadata(ROLES_KEY, PresenceController.prototype.ping)).toBeUndefined();
    const presence: any = { heartbeat: jest.fn(), count: jest.fn().mockResolvedValue(7), thresholdMs: 300_000 };
    const ctl = new PresenceController(presence);
    expect(await ctl.ping('u1', { active: false })).toEqual({ count: 7, thresholdSeconds: 300 });
    expect(presence.heartbeat).not.toHaveBeenCalled(); // an idle ping only reads
    await ctl.ping('u1', { active: true });
    expect(presence.heartbeat).toHaveBeenCalledWith('u1');
  });

  it('the list response has only the fields the dialog needs', async () => {
    const presence: any = {
      thresholdMs: 300_000,
      listFor: jest.fn().mockResolvedValue([{ id: 'u1', fullName: 'A', username: 'a', role: 'TESTER', assignedTlId: 'x', teamLeadName: 'TL', status: 'IDLE', lastActiveAt: new Date(Date.now() - 90_000) }]),
    };
    const res = await new PresenceController(presence).activeUsers({ id: 'admin', role: UserRole.ADMIN } as any);
    expect(Object.keys(res.users[0]).sort()).toEqual(['fullName', 'id', 'idleSeconds', 'lastActiveAt', 'role', 'status', 'teamLead', 'username']);
  });
});

describe('PresenceController idle details', () => {
  it('reports status and how long each user has been idle, in whole seconds', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    const presence: any = {
      thresholdMs: 300_000,
      listFor: jest.fn().mockResolvedValue([
        { id: 'a', fullName: 'A', username: 'a', role: 'TESTER', assignedTlId: null, teamLeadName: null, status: 'ACTIVE', lastActiveAt: new Date(NOW - 20_000) },
        { id: 'b', fullName: 'B', username: 'b', role: 'TESTER', assignedTlId: null, teamLeadName: null, status: 'IDLE', lastActiveAt: new Date(NOW - 15 * 60_000) },
      ]),
    };
    const res = await new PresenceController(presence).activeUsers({ id: 'admin', role: UserRole.ADMIN } as any);
    expect(res.users.map((u) => [u.id, u.status, u.idleSeconds])).toEqual([['a', 'ACTIVE', 20], ['b', 'IDLE', 900]]);
    jest.restoreAllMocks();
  });
});
