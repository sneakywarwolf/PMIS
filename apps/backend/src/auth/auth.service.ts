import { Injectable, UnauthorizedException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { LoginDto, ChangePasswordDto } from './dto/auth.dto';
import { v4 as uuidv4 } from 'uuid';
import { User } from '@prisma/client';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private redisService: RedisService,
    private configService: ConfigService,
    private auditService: AuditService,
    private settingsService: SettingsService,
  ) {}

  async validateUser(username: string, password: string, ipAddress: string, userAgent: string) {
    const normalizedInput = username.trim();

    // 1. Try exact username match
    let user = await this.prisma.user.findUnique({
      where: { username: normalizedInput },
    });

    // 2. Try exact email match
    if (!user) {
      user = await this.prisma.user.findUnique({
        where: { email: normalizedInput },
      });
    }

    // 3. Try case-insensitive email match (manual fallback)
    if (!user && normalizedInput.includes('@')) {
      const allUsers = await this.prisma.user.findMany({
        select: { id: true, username: true, email: true, passwordHash: true, role: true, fullName: true, isActive: true, assignedTlId: true, isForcePasswordChange: true, lastLoginAt: true },
        take: 500,
      });
      user = (allUsers.find(u => u.email && u.email.toLowerCase() === normalizedInput.toLowerCase()) as any) || null;
    }

    if (!user || !user.isActive) {
      await this.redisService.incrementLoginAttempts(normalizedInput);
      throw new UnauthorizedException('Invalid credentials');
    }

    const lockoutKey = user.username;

    // Check account lockout
    const isLocked = await this.redisService.isAccountLocked(lockoutKey);
    if (isLocked) {
      this.logger.warn(`Login attempt on locked account: ${lockoutKey} from ${ipAddress}`);
      throw new UnauthorizedException('Account is temporarily locked. Please try again in 15 minutes.');
    }

    const isPasswordValid = await argon2.verify(user.passwordHash, password);

    if (!isPasswordValid) {
      const attempts = await this.redisService.incrementLoginAttempts(lockoutKey);
      this.logger.warn(`Failed login attempt ${attempts} for ${lockoutKey} from ${ipAddress}`);
      
      const maxAttempts = this.configService.get<number>('MAX_LOGIN_ATTEMPTS', 5);
      if (attempts >= maxAttempts) {
        throw new UnauthorizedException('Account is temporarily locked. Please try again in 15 minutes.');
      }
      
      throw new UnauthorizedException('Invalid credentials');
    }

    // Reset login attempts on successful login
    await this.redisService.resetLoginAttempts(lockoutKey);

    // Update last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Audit log
    await this.auditService.log({
      actorId: user.id,
      action: 'LOGIN',
      ipAddress,
      userAgent,
      details: { username: user.username },
    });

    return this.generateTokens(user);
  }

  async refreshTokens(refreshToken: string, ipAddress: string, userAgent: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
      });

      const storedUserId = await this.redisService.getRefreshTokenUserId(payload.jti);
      
      if (!storedUserId || storedUserId !== payload.sub) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user || !user.isActive) {
        throw new UnauthorizedException('User not found or inactive');
      }

      // A refresh token from a session that's been superseded by a newer
      // login must not be allowed to resurrect itself — otherwise it could
      // ping-pong the active-session pointer back and boot out the
      // legitimate, newer session on its next request.
      if (payload.sessionId) {
        const activeSessionId = await this.redisService.getActiveSession(payload.sub);
        if (activeSessionId !== payload.sessionId) {
          throw new UnauthorizedException('Session has been signed in elsewhere');
        }

        // Inactivity: the idle key expires after security.sessionTimeoutMinutes
        // without an authenticated request. Without this, the silent refresh
        // would revive an idle session for the refresh token's whole lifetime.
        if (!(await this.redisService.isSessionActive(payload.sessionId))) {
          throw new UnauthorizedException('Session expired due to inactivity');
        }
      }

      // Revoke old refresh token
      await this.redisService.revokeRefreshToken(payload.jti);

      // Renewing an access token is still the same logical session — reuse
      // its sessionId rather than minting a new one (which would look like
      // a fresh login and immediately invalidate itself on the next check).
      return this.generateTokens(user, payload.sessionId);
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(userId: string, refreshToken: string, ipAddress: string, userAgent: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
      });
      await this.redisService.revokeRefreshToken(payload.jti);
    } catch (error) {
      // Token might already be expired, that's okay
    }

    const sessionId = await this.redisService.getActiveSession(userId);
    if (sessionId) await this.redisService.clearSessionActivity(sessionId);
    await this.redisService.clearActiveSession(userId);

    await this.auditService.log({
      actorId: userId,
      action: 'LOGOUT',
      ipAddress,
      userAgent,
    });
  }

  async changePassword(userId: string, dto: ChangePasswordDto, ipAddress: string, userAgent: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.isForcePasswordChange) {
      // Forced change (new-user default password or an admin-issued temp
      // password) — the user already proved possession of it by logging
      // in, so don't make them re-enter it here.
    } else {
      if (!dto.currentPassword) {
        throw new BadRequestException('Current password is required');
      }
      const isCurrentValid = await argon2.verify(user.passwordHash, dto.currentPassword);
      if (!isCurrentValid) {
        throw new BadRequestException('Current password is incorrect');
      }
    }

    const policyErrors = await this.settingsService.validatePassword(dto.newPassword);
    if (policyErrors.length > 0) {
      throw new BadRequestException(policyErrors.join('; '));
    }

    const newHash = await argon2.hash(dto.newPassword, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: newHash,
        isForcePasswordChange: false,
      },
    });

    // Revoke all refresh tokens
    await this.redisService.revokeAllUserTokens(userId);

    await this.auditService.log({
      actorId: userId,
      action: 'PASSWORD_CHANGE',
      ipAddress,
      userAgent,
    });
  }

  private async generateTokens(user: User, existingSessionId?: string) {
    // A login (no existingSessionId) mints a fresh one and overwrites the
    // user's active-session pointer, which immediately invalidates any
    // other session on its next request — only one session per user.
    // A token refresh reuses the caller's sessionId: it's the same session.
    const sessionId = existingSessionId || uuidv4();

    const payload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      assignedTlId: user.assignedTlId,
      sessionId,
    };

    // Access-token lifetime follows the admin-configured
    // security.sessionTimeoutMinutes setting.
    const { settings } = await this.settingsService.get();
    const accessExpirySeconds = settings.security.sessionTimeoutMinutes * 60;
    const accessExpiry = `${accessExpirySeconds}s`;
    const refreshExpiryDays = 7;
    const refreshExpirySeconds = refreshExpiryDays * 24 * 60 * 60;

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get('JWT_ACCESS_SECRET'),
      expiresIn: accessExpiry,
    });

    const jti = uuidv4();
    const refreshToken = this.jwtService.sign(
      { ...payload, jti },
      {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
        expiresIn: `${refreshExpiryDays}d`,
      },
    );

    // Store refresh token in Redis
    await this.redisService.storeRefreshToken(jti, user.id, refreshExpirySeconds);
    await this.redisService.setActiveSession(user.id, sessionId, refreshExpirySeconds);
    // Login/refresh counts as activity; from here each request re-arms it.
    await this.redisService.touchSessionActivity(sessionId, accessExpirySeconds);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      access_expiry_seconds: accessExpirySeconds,
      refresh_expiry_seconds: refreshExpirySeconds,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        isForcePasswordChange: user.isForcePasswordChange,
      },
    };
  }
}
