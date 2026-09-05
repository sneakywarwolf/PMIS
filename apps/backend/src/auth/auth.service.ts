import { Injectable, UnauthorizedException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AuditService } from '../audit/audit.service';
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
  ) {}

  async validateUser(username: string, password: string, ipAddress: string, userAgent: string, rememberMe?: boolean) {
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
      details: { username: user.username, rememberMe: !!rememberMe },
    });

    return this.generateTokens(user, rememberMe);
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

      // Revoke old refresh token
      await this.redisService.revokeRefreshToken(payload.jti);

      return this.generateTokens(user);
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

    const isCurrentValid = await argon2.verify(user.passwordHash, dto.currentPassword);
    if (!isCurrentValid) {
      throw new BadRequestException('Current password is incorrect');
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

  private async generateTokens(user: User, rememberMe?: boolean) {
    const payload = { 
      sub: user.id, 
      username: user.username, 
      role: user.role,
      assignedTlId: user.assignedTlId,
    };

    // If remember me, extend session to 24h access / 30d refresh
    const accessExpiry = rememberMe ? '24h' : this.configService.get('JWT_ACCESS_EXPIRY', '15m');
    const refreshExpiryDays = rememberMe ? 30 : 7;
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

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      remember_me: !!rememberMe,
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
