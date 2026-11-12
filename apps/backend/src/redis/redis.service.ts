import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor(private readonly configService: ConfigService) {
    const redisUrl = configService.get<string>('REDIS_URL') || 'redis://localhost:6379';
    super(redisUrl);
    
    this.on('connect', () => {
      this.logger.log('Redis connected successfully');
    });
    
    this.on('error', (err) => {
      this.logger.error('Redis connection error:', err);
    });
  }

  async onModuleDestroy() {
    await this.quit();
    this.logger.log('Redis connection closed');
  }

  // Account lockout methods
  /** Counts one more failed-or-pending sign-in; the window starts at the first attempt. Atomic, so parallel requests each get a distinct count. */
  async incrementLoginAttempts(username: string, windowSeconds = 900): Promise<number> {
    const key = `login_attempts:${username}`;
    const attempts = await this.incr(key);
    if (attempts === 1) {
      await this.expire(key, windowSeconds);
    }
    return attempts;
  }

  /** Restarts the window (used when a name that has no account reaches the limit, so it is locked for the full duration like a real one). */
  async restartLoginAttemptsWindow(username: string, windowSeconds: number): Promise<void> {
    await this.expire(`login_attempts:${username}`, windowSeconds);
  }

  // ---- Temporary account locks. The record carries the server-generated start and expiry; the key outlives the expiry a little
  // so the expiry can be recorded in the audit log by whoever removes it first (see AccountLockService).
  async createAccountLock(userId: string, record: string, ttlMs: number): Promise<boolean> {
    return (await this.set(`account_lock:${userId}`, record, 'PX', ttlMs, 'NX')) === 'OK'; // NX: exactly one creator wins
  }

  async getAccountLock(userId: string): Promise<string | null> {
    return this.get(`account_lock:${userId}`);
  }

  /** True only for the call that actually removed the lock (DEL is atomic), so a removal is audited exactly once. */
  async deleteAccountLock(userId: string): Promise<boolean> {
    return (await this.del(`account_lock:${userId}`)) === 1;
  }

  async listAccountLocks(): Promise<string[]> {
    const out: string[] = [];
    let cursor = '0';
    do {
      const [next, keys] = await this.scan(cursor, 'MATCH', 'account_lock:*', 'COUNT', 200);
      cursor = next;
      if (keys.length) for (const v of await this.mget(...keys)) if (v) out.push(v);
    } while (cursor !== '0');
    return out;
  }

  async getLoginAttempts(username: string): Promise<number> {
    const attempts = await this.get(`login_attempts:${username}`);
    return attempts ? parseInt(attempts, 10) : 0;
  }

  async resetLoginAttempts(username: string): Promise<void> {
    await this.del(`login_attempts:${username}`);
  }

  async isAccountLocked(username: string): Promise<boolean> {
    const attempts = await this.getLoginAttempts(username);
    const maxAttempts = parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10);
    return attempts >= maxAttempts;
  }

  // Refresh token methods
  async storeRefreshToken(tokenId: string, userId: string, expiresIn: number): Promise<void> {
    await this.setex(`refresh_token:${tokenId}`, expiresIn, userId);
  }

  async getRefreshTokenUserId(tokenId: string): Promise<string | null> {
    return this.get(`refresh_token:${tokenId}`);
  }

  /** Deletes the token and says whether this call was the one that removed it (DEL is atomic: one winner). */
  async revokeRefreshToken(tokenId: string): Promise<boolean> {
    return (await this.del(`refresh_token:${tokenId}`)) === 1;
  }

  async revokeAllUserTokens(userId: string): Promise<void> {
    // SCAN, not KEYS: KEYS walks the whole keyspace in one blocking call, stalling every login and request on this Redis.
    let cursor = '0';
    do {
      const [next, keys] = await this.scan(cursor, 'MATCH', 'refresh_token:*', 'COUNT', 500);
      cursor = next;
      for (const key of keys) {
        if ((await this.get(key)) === userId) await this.del(key);
      }
    } while (cursor !== '0');
  }

  // Rate limiting methods
  async incrementRateLimit(key: string, windowMs: number): Promise<number> {
    const current = await this.incr(key);
    if (current === 1) {
      await this.pexpire(key, windowMs);
    }
    return current;
  }

  // Single-session enforcement: only one active session per user. A new
  // login overwrites the pointer, so the previous session's requests fail
  // their sessionId check on JwtAuthGuard and are logged out immediately.
  async setActiveSession(userId: string, sessionId: string, ttlSeconds: number): Promise<void> {
    await this.setex(`active_session:${userId}`, ttlSeconds, sessionId);
  }

  async getActiveSession(userId: string): Promise<string | null> {
    return this.get(`active_session:${userId}`);
  }

  async clearActiveSession(userId: string): Promise<void> {
    await this.del(`active_session:${userId}`);
  }

  // Inactivity enforcement: one key per session whose TTL *is* the idle
  // timeout. Every authenticated request (and login/refresh) re-arms it, so a
  // missing key means the session has been idle longer than the configured
  // security.sessionTimeoutMinutes — no clock comparison needed.
  async touchSessionActivity(sessionId: string, ttlSeconds: number): Promise<void> {
    await this.setex(`session_activity:${sessionId}`, ttlSeconds, '1');
  }

  async clearSessionActivity(sessionId: string): Promise<void> {
    await this.del(`session_activity:${sessionId}`);
  }

  async isSessionActive(sessionId: string): Promise<boolean> {
    return (await this.exists(`session_activity:${sessionId}`)) === 1;
  }
}
