import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/roles.decorator';
import { RedisService } from '../../redis/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import { verifyAccessToken } from '../verify-access-token';
import { SettingsService } from '../../settings/settings.service';

// Endpoints a user with a pending forced password change may still reach —
// everything else is blocked server-side so the requirement can't be
// bypassed by skipping the frontend redirect.
const FORCE_PASSWORD_CHANGE_ALLOWED_PATHS = new Set([
  '/auth/me',
  '/auth/change-password',
  '/auth/logout',
  '/auth/refresh',
]);

// GET-only, read-only config the app shell needs to even render the forced
// change-password screen (branding, idle-timeout settings) — not "app
// access", so safe to allow read access while blocking writes.
const FORCE_PASSWORD_CHANGE_ALLOWED_GET_PATHS = new Set(['/settings']);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private jwtService: JwtService,
    private redisService: RedisService,
    private prismaService: PrismaService,
    private settingsService: SettingsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractTokenFromCookie(request);

    if (!token) {
      throw new UnauthorizedException('Authentication required');
    }

    try {
      // Every authenticated request re-arms the session's idle timer (see verifyAccessToken).
      const user = await verifyAccessToken(token, this.jwtService, this.redisService, this.prismaService, () =>
        this.settingsService.getSessionTimeoutSeconds(),
      );

      const isAllowedDuringForceChange =
        FORCE_PASSWORD_CHANGE_ALLOWED_PATHS.has(request.path) ||
        (request.method === 'GET' && FORCE_PASSWORD_CHANGE_ALLOWED_GET_PATHS.has(request.path));

      if (user.isForcePasswordChange && !isAllowedDuringForceChange) {
        throw new ForbiddenException({
          message: 'Password change required before continuing',
          code: 'PASSWORD_CHANGE_REQUIRED',
        });
      }

      request.user = user;
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private extractTokenFromCookie(request: Request): string | undefined {
    return request.cookies?.access_token;
  }
}
