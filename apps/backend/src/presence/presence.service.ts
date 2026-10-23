import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';

/** Redis sorted set: userId -> time (ms) of the last heartbeat that carried real user activity. One entry per user. */
const LAST_SEEN_KEY = 'presence:last_seen';
/** Entries older than this are dropped, so the set never accumulates history. */
const KEEP_MS = 60 * 60 * 1000;
/** The live set is computed at most this often however many clients poll. */
const CACHE_MS = 10_000;
/** Clients ping every 30s; a threshold below two beats would make users flicker out between pings. */
const MIN_THRESHOLD_MINUTES = 2;

export type LiveUser = {
  id: string;
  username: string;
  fullName: string | null;
  role: UserRole;
  assignedTlId: string | null;
  teamLeadName: string | null;
  lastActiveAt: Date;
};

type Caller = { id: string; role: UserRole };

/**
 * Who is "live": signed in, enabled, and showing real activity within the inactivity threshold.
 *
 * - The client sends a heartbeat only when the person has actually used the page recently (mouse, keys,
 *   scroll, touch), so a forgotten open tab stops counting after the threshold even though background
 *   polling keeps its session alive.
 * - Presence is stored per USER (not per tab or session), so several tabs never inflate the count.
 * - Each read re-checks the user's session in Redis (the same keys login/logout/idle-timeout maintain) and
 *   their account in the database, so logged-out, expired, disabled and deleted users drop out at once
 *   without this feature touching login or logout.
 */
@Injectable()
export class PresenceService {
  private cache: { at: number; users: LiveUser[]; ids: Set<string> } | null = null;
  /** The computation currently running, shared by everyone who asks while it is in flight. */
  private inflight: Promise<{ at: number; users: LiveUser[]; ids: Set<string> }> | null = null;

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
    // A user who was not in the current snapshot must show up in the very next count, not 10s later.
    if (!this.cache?.ids.has(userId)) this.cache = null;
  }

  async count(): Promise<number> {
    return (await this.live()).users.length;
  }

  /**
   * The live users the caller is allowed to see: Admin everyone; Team Lead and AVP their own team (the users
   * assigned to them, same rule as the Users page) plus themselves. Anyone else gets nothing.
   */
  async listFor(caller: Caller): Promise<LiveUser[]> {
    const { users } = await this.live();
    if (caller.role === UserRole.ADMIN) return users;
    if (caller.role === UserRole.TEAM_LEAD || caller.role === UserRole.AVP) {
      return users.filter((u) => u.id === caller.id || u.assignedTlId === caller.id);
    }
    return [];
  }

  private live() {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return Promise.resolve(this.cache);
    this.inflight ??= this.compute().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async compute() {
    const now = Date.now();
    const flat = await this.redis.zrangebyscore(LAST_SEEN_KEY, now - this.thresholdMs, '+inf', 'WITHSCORES');
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
          .map((u) => ({
            id: u.id,
            username: u.username,
            fullName: u.fullName,
            role: u.role,
            assignedTlId: u.assignedTlId,
            teamLeadName: u.assignedTl ? u.assignedTl.fullName || u.assignedTl.username : null,
            lastActiveAt: new Date(seen.get(u.id)!),
          }))
          .sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime());
      }
    }

    this.cache = { at: now, users, ids: new Set(users.map((u) => u.id)) };
    return this.cache;
  }
}
