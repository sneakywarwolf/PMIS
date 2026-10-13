import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { RedisService } from '../redis/redis.service';
import { rateLimit, isHeavyRoute, RateLimitConfig } from './rate-limit';

// Runs after JwtAuthGuard: logged-in requests are limited per user, public ones (login, refresh) per IP.
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly cfg: RateLimitConfig;
  private readonly heavyPerMin: number;

  constructor(private redis: RedisService, config: ConfigService) {
    this.cfg = {
      perMin: Number(config.get('RATE_LIMIT_PER_MIN', 300)),
      anonPerMin: Number(config.get('AUTH_RATE_LIMIT_PER_MIN', 30)),
    };
    this.heavyPerMin = Number(config.get('HEAVY_RATE_LIMIT_PER_MIN', 20));
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request & { user?: { id: string } }>();

    let result;
    try {
      result = await rateLimit((k, ms) => this.redis.incrementRateLimit(k, ms), { userId: req.user?.id, ip: req.ip ?? 'unknown' }, this.cfg);
    } catch {
      return true; // fail open: a Redis hiccup must not take PMIS down with it
    }
    if (result.allowed && req.user?.id && isHeavyRoute(req.method, req.path)) {
      try {
        const n = await this.redis.incrementRateLimit(`rlh:${req.user.id}:${Math.floor(Date.now() / 60_000)}`, 60_000);
        if (n > this.heavyPerMin) result = { allowed: false, retryAfterSec: 30, firstRejection: n === this.heavyPerMin + 1 };
      } catch {
        // fail open, same as above
      }
    }
    if (result.allowed) return true;

    // Operational metric only: scope and route pattern, no ids, IPs or payloads. Once per key per window.
    if (result.firstRejection) this.logger.warn(`Rate limit hit: scope=${req.user ? 'user' : 'anon'} route=${req.route?.path ?? '?'}`);
    context.switchToHttp().getResponse<Response>().setHeader('Retry-After', String(result.retryAfterSec));
    throw new HttpException('Too many requests. Please slow down.', HttpStatus.TOO_MANY_REQUESTS);
  }
}
