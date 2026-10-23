import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';

/** Redis sorted set: userId -> time (ms) of the last heartbeat that carried real user activity. One entry per user. */
const LAST_SEEN_KEY = 'presence:last_seen';
/**
 * How long a signed-in user can stay in the set while idle. A tab left open keeps its session alive in the background,
 * so this bounds how long "idle for X" can be reported; entries older than this are dropped (no long history is kept).
 */
const KEEP_MS = 24 * 60 * 60 * 1000;
/** The live set is computed at most this often however many clients poll. */
const CACHE_MS = 10_000;
/** Clients ping every 30s; a threshold below two beats would make users flicker out between pings. */
const MIN_THRESHOLD_MINUTES = 2;

export type PresenceStatus = 'ACTIVE' | 'IDLE';

export type LiveUser = {
  id: string;
  username: string;
  fullName: string | null;
  role: UserRole;
  assignedTlId: string | null;
  teamLeadName: string | null;
  lastActiveAt: Date;
  /** ACTIVE: used the app within the inactivity threshold. IDLE: signed in but not used for longer than that. */
  status: PresenceStatus;
};

type Caller = { id: string; role: UserRole };
type Snapshot = { at: number; users: LiveUser[]; activeIds: Set<string> };

/**
 * Who is signed in and, of those, who is actually active.
 *
 * - The client sends a heartbeat flagged `active` only when the person has used the page recently (mouse, keys,
 *   scroll, touch), so a forgotten open tab goes IDLE after the threshold even though background polling keeps its
 *   session alive.
 * - Presence is stored per USER (not per tab or session), so several tabs never inflate anything.
 * - Each read re-checks the user's session in Redis (the same keys login/logout/idle-timeout maintain) and their
 *   account in the database, so logged-out, expired, disabled and deleted users drop out at once without this
 *   feature touching login or logout.
 * - The public live COUNT is ACTIVE users only. Idle users appear only in the role-restricted list.
 */
@Injectable()
export class PresenceService {
  private cache: Snapshot | null = null;
  /** The computation currently running, shared by everyone who asks while it is in flight. */
  private inflight: Promise<Snapshot> | null = null;

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Inactivity threshold in ms: LIVE_USERS_INACTIVITY_MINUTES, default 5. */
  get thresholdMs(): number {
    const minutes = Number(this.config.get('LIVE_USERS_INACTIVITY_MINUTES'));
    return (Number.isFinite(minutes) && minutes >= MIN_THRESHOLD_MINUTES ? Math.min(minutes, 120) : 5) * 60_000;
  }

  /** Records that this user is active right now. */
  async heartbeat(userId: string): Promise<void> {
    await this.redis.zadd(LAST_SEEN_KEY, Date.now(), userId);
    // A user who was not ACTIVE in the current snapshot must show up in the very next count, not 10s later.
    if (!this.cache?.activeIds.has(userId)) this.cache = null;
  }

  /** Number of users active right now (idle users are not counted). */
  async count(): Promise<number> {
    return (await this.snapshot()).activeIds.size;
  }

  /**
   * The signed-in users (active and idle) the caller may see.
   * - Admin: everyone.
   * - AVP: themselves, the Team Leads who report to them, and everyone on those Team Leads' teams (plus anyone
   *   assigned to the AVP directly).
   * - Team Lead: themselves and their own team.
   * - Anyone else: nothing.
   */
  async listFor(caller: Caller): Promise<LiveUser[]> {
    const { users } = await this.snapshot();
    if (caller.role === UserRole.ADMIN) return users;
    if (caller.role === UserRole.TEAM_LEAD) {
      return users.filter((u) => u.id === caller.id || u.assignedTlId === caller.id);
    }
    if (caller.role === UserRole.AVP) {
      const tls = await this.prisma.user.findMany({
        where: { managerId: caller.id, role: UserRole.TEAM_LEAD },
        select: { id: true },
      });
      const leads = new Set([caller.id, ...tls.map((t) => t.id)]);
      return users.filter((u) => leads.has(u.id) || (u.assignedTlId !== null && leads.has(u.assignedTlId)));
    }
    return [];
  }

  private snapshot(): Promise<Snapshot> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return Promise.resolve(this.cache);
    this.inflight ??= this.compute().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async compute(): Promise<Snapshot> {
    const now = Date.now();
    const activeAfter = now - this.thresholdMs;
    const flat = await this.redis.zrangebyscore(LAST_SEEN_KEY, now - KEEP_MS, '+inf', 'WITHSCORES');
    void this.redis.zremrangebyscore(LAST_SEEN_KEY, '-inf', now - KEEP_MS).catch(() => undefined);

    const seen = new Map<string, number>();
    for (let i = 0; i < flat.length; i += 2) seen.set(flat[i], Number(flat[i + 1]));

    let users: LiveUser[] = [];
    if (seen.size > 0) {
      const ids = [...seen.keys()];

      // Still holding a valid, un-expired session? (Two Redis round trips for everyone, not one per user.)
      const sessionIds = await this.redis.mget(ids.map((id) => `active_session:${id}`));
      const pipe = this.redis.pipeline();
      sessionIds.forEach((sid) => (sid ? pipe.exists(`session_activity:${sid}`) : pipe.exists('presence:none')));
      const checks = (await pipe.exec()) ?? [];
      const withSession = ids.filter((_, i) => sessionIds[i] && checks[i]?.[1] === 1);

      if (withSession.length > 0) {
        const rows = await this.prisma.user.findMany({
          where: { id: { in: withSession }, isActive: true, deletedAt: null },
          select: { id: true, username: true, fullName: true, role: true, assignedTlId: true, assignedTl: { select: { fullName: true, username: true } } },
        });
        users = rows
          .map((u): LiveUser => {
            const at = seen.get(u.id)!;
            return {
              id: u.id,
              username: u.username,
              fullName: u.fullName,
              role: u.role,
              assignedTlId: u.assignedTlId,
              teamLeadName: u.assignedTl ? u.assignedTl.fullName || u.assignedTl.username : null,
              lastActiveAt: new Date(at),
              status: at >= activeAfter ? 'ACTIVE' : 'IDLE',
            };
          })
          // Active first, then idle; most recent activity first within each.
          .sort((a, b) => (a.status === b.status ? b.lastActiveAt.getTime() - a.lastActiveAt.getTime() : a.status === 'ACTIVE' ? -1 : 1));
      }
    }

    this.cache = { at: now, users, activeIds: new Set(users.filter((u) => u.status === 'ACTIVE').map((u) => u.id)) };
    return this.cache;
  }
}
