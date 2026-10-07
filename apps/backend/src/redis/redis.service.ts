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
  async incrementLoginAttempts(username: string): Promise<number> {
    const key = `login_attempts:${username}`;
    const attempts = await this.incr(key);
    if (attempts === 1) {
      await this.expire(key, 900); // 15 minutes
    }
    return attempts;
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

  async revokeRefreshToken(tokenId: string): Promise<void> {
    await this.del(`refresh_token:${tokenId}`);
  }

  async revokeAllUserTokens(userId: string): Promise<void> {
    const keys = await this.keys(`refresh_token:*`);
    for (const key of keys) {
      const uid = await this.get(key);
      if (uid === userId) {
        await this.del(key);
      }
    }
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
