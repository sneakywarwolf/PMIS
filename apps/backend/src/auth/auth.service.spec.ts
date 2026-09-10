import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';

describe('AuthService.refreshTokens — single-session enforcement', () => {
  let service: AuthService;
  let jwtService: { verify: jest.Mock; sign: jest.Mock };
  let redisService: {
    getRefreshTokenUserId: jest.Mock;
    getActiveSession: jest.Mock;
    revokeRefreshToken: jest.Mock;
    storeRefreshToken: jest.Mock;
    setActiveSession: jest.Mock;
  };
  let prisma: { user: { findUnique: jest.Mock } };

  beforeEach(async () => {
    jwtService = { verify: jest.fn(), sign: jest.fn().mockReturnValue('signed-token') };
    redisService = {
      getRefreshTokenUserId: jest.fn().mockResolvedValue('u1'),
      getActiveSession: jest.fn(),
      revokeRefreshToken: jest.fn(),
      storeRefreshToken: jest.fn(),
      setActiveSession: jest.fn(),
    };
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', isActive: true, username: 'u', assignedTlId: null }) },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        { provide: RedisService, useValue: redisService },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: AuditService, useValue: { log: jest.fn() } },
        {
          provide: SettingsService,
          useValue: { get: jest.fn().mockResolvedValue({ settings: { security: { sessionTimeoutMinutes: 15 } } }) },
        },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  it('reuses the refresh token\'s sessionId when it still matches the active session', async () => {
    jwtService.verify.mockReturnValue({ sub: 'u1', jti: 'jti-1', sessionId: 'session-A' });
    redisService.getActiveSession.mockResolvedValue('session-A');

    await service.refreshTokens('rt', '1.2.3.4', 'jest');

    expect(redisService.setActiveSession).toHaveBeenCalledWith('u1', 'session-A', expect.any(Number));
  });

  it('rejects refreshing a token whose session has been superseded by a newer login', async () => {
    jwtService.verify.mockReturnValue({ sub: 'u1', jti: 'jti-old', sessionId: 'session-OLD' });
    redisService.getActiveSession.mockResolvedValue('session-NEW');

    await expect(service.refreshTokens('rt', '1.2.3.4', 'jest')).rejects.toThrow(UnauthorizedException);
    expect(redisService.setActiveSession).not.toHaveBeenCalled();
    expect(redisService.revokeRefreshToken).not.toHaveBeenCalled();
  });
});
