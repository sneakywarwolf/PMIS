import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AuditService } from '../audit/audit.service';

export const LOCK_REASON = 'TOO_MANY_FAILED_LOGINS';
/** The Redis key outlives the expiry by this long, so the expiry can be recorded in the audit log by the sweep (or the next sign-in). */
const GRACE_MS = 60 * 60 * 1000;

export interface LockRecord {
  userId: string;
  reason: string;
  lockedAt: string; // ISO, generated here on the server
  expiresAt: string; // ISO, generated here on the server
  attempts: number;
}

/**
 * Temporary account locks. The backend is the only source of truth: a lock is a server-side record with a server-generated expiry, and
 * whether an account is locked is always decided by comparing that expiry with the server clock, never by anything the browser says.
 */
@Injectable()
export class AccountLockService {
  private readonly logger = new Logger(AccountLockService.name);

  constructor(
    private redis: RedisService,
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private parse(raw: string | null): LockRecord | null {
    if (!raw) return null;
    try {
      const r = JSON.parse(raw);
      return typeof r?.userId === 'string' && !Number.isNaN(Date.parse(r.expiresAt)) && !Number.isNaN(Date.parse(r.lockedAt)) ? (r as LockRecord) : null;
    } catch {
      return null;
    }
  }

  private isActive(r: LockRecord, now = Date.now()) {
    return Date.parse(r.expiresAt) > now;
  }

  /** Locks the account for `durationMinutes` from now. Only the request that creates the record writes the audit entry. */
  async lock(user: { id: string; username: string }, attempts: number, durationMinutes: number, ipAddress: string, userAgent: string): Promise<void> {
    const now = Date.now();
    const record: LockRecord = {
      userId: user.id,
      reason: LOCK_REASON,
      lockedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + durationMinutes * 60_000).toISOString(),
      attempts,
    };
    const created = await this.redis.createAccountLock(user.id, JSON.stringify(record), durationMinutes * 60_000 + GRACE_MS);
    if (!created) return; // another request locked it first
    this.logger.warn(`Account locked: ${user.username} until ${record.expiresAt}`);
    await this.audit.log({
      actorId: user.id,
      action: 'ACCOUNT_LOCKED',
      targetType: 'USER',
      targetId: user.id,
      targetUserId: user.id,
      ipAddress,
      userAgent,
      details: { username: user.username, reason: record.reason, attempts, lockedAt: record.lockedAt, expiresAt: record.expiresAt, durationMinutes },
    });
  }

  /** The current lock, or null. A lock found past its expiry is removed (and its expiry audited) on the spot. */
  async getActive(userId: string): Promise<LockRecord | null> {
    const record = this.parse(await this.redis.getAccountLock(userId));
    if (!record) return null;
    if (this.isActive(record)) return record;
    await this.expire(record);
    return null;
  }

  private async expire(record: LockRecord): Promise<void> {
    if (!(await this.redis.deleteAccountLock(record.userId))) return; // someone else already removed it
    await this.audit.log({
      actorId: record.userId,
      action: 'ACCOUNT_LOCK_EXPIRED',
      targetType: 'USER',
      targetId: record.userId,
      targetUserId: record.userId,
      ipAddress: 'system',
      userAgent: 'system',
      details: { reason: record.reason, lockedAt: record.lockedAt, expiresAt: record.expiresAt },
    });
  }

  /** Every account that is locked now, with what an Admin needs to see. Never any credential or token. */
  async listActive() {
    const now = Date.now();
    const records = (await this.redis.listAccountLocks()).map((r) => this.parse(r)).filter((r): r is LockRecord => !!r && this.isActive(r, now));
    if (!records.length) return { serverTime: new Date(now).toISOString(), locks: [] };
    const users = await this.prisma.user.findMany({
      where: { id: { in: records.map((r) => r.userId) } },
      select: { id: true, username: true, fullName: true, email: true, role: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    const locks = records
      .filter((r) => byId.has(r.userId))
      .map((r) => {
        const u = byId.get(r.userId)!;
        // Explicit fields only: nothing else on the user row (a password hash, for instance) can ever be copied into this response.
        return { userId: r.userId, username: u.username, fullName: u.fullName, email: u.email, role: u.role, reason: r.reason, lockedAt: r.lockedAt, expiresAt: r.expiresAt, status: 'LOCKED' as const };
      })
      .sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt));
    return { serverTime: new Date(now).toISOString(), locks };
  }

  /** Removes the lock and the failed-attempt counter. It does nothing else: the next sign-in still needs the password and every other control. */
  async unlock(userId: string, adminId: string, ipAddress: string, userAgent: string) {
    const record = this.parse(await this.redis.getAccountLock(userId));
    if (!record || !this.isActive(record)) {
      if (record) await this.expire(record);
      throw new NotFoundException('This account is not temporarily locked');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true } });
    if (!user) throw new NotFoundException('User not found');
    if (!(await this.redis.deleteAccountLock(userId))) throw new NotFoundException('This account is not temporarily locked');
    await this.redis.resetLoginAttempts(user.username);
    await this.audit.log({
      actorId: adminId,
      action: 'ACCOUNT_UNLOCKED',
      targetType: 'USER',
      targetId: userId,
      targetUserId: userId,
      ipAddress,
      userAgent,
      details: { username: user.username, lockedAt: record.lockedAt, scheduledUnlockAt: record.expiresAt, unlockedAt: new Date().toISOString() },
    });
    return { userId, status: 'UNLOCKED' as const };
  }

  /** Records expiries even when nobody has the page open or tries to sign in. */
  @Cron('*/30 * * * * *')
  async sweepExpired(): Promise<void> {
    try {
      const now = Date.now();
      for (const raw of await this.redis.listAccountLocks()) {
        const r = this.parse(raw);
        if (r && !this.isActive(r, now)) await this.expire(r);
      }
    } catch (e) {
      this.logger.error(`Lock sweep failed: ${(e as Error).message}`);
    }
  }
}
