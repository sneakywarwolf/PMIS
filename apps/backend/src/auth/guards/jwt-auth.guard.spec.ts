import { Test } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RedisService } from '../../redis/redis.service';
import { PrismaService } from '../../prisma/prisma.service';

function makeContext(cookies: Record<string, string>): ExecutionContext {
  const request: any = { cookies };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as any;
}

describe('JwtAuthGuard — single-session enforcement', () => {
  let guard: JwtAuthGuard;
  let jwtService: { verify: jest.Mock };
  let redisService: { getActiveSession: jest.Mock };
  let prismaService: { user: { findUnique: jest.Mock } };

  beforeEach(async () => {
    jwtService = { verify: jest.fn() };
    redisService = { getActiveSession: jest.fn() };
    prismaService = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'u1', isActive: true, role: 'TESTER' }),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        Reflector,
        { provide: JwtService, useValue: jwtService },
        { provide: RedisService, useValue: redisService },
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();
    guard = moduleRef.get(JwtAuthGuard);
  });

  it('allows the request when the token sessionId matches the active session', async () => {
    jwtService.verify.mockReturnValue({ sub: 'u1', sessionId: 'session-A' });
    redisService.getActiveSession.mockResolvedValue('session-A');

    const context = makeContext({ access_token: 'valid-token' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects the request when a newer login elsewhere has changed the active session', async () => {
    jwtService.verify.mockReturnValue({ sub: 'u1', sessionId: 'session-OLD' });
    redisService.getActiveSession.mockResolvedValue('session-NEW');

    const context = makeContext({ access_token: 'old-token' });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects when there is no active session recorded at all (e.g. logged out)', async () => {
    jwtService.verify.mockReturnValue({ sub: 'u1', sessionId: 'session-A' });
    redisService.getActiveSession.mockResolvedValue(null);

    const context = makeContext({ access_token: 'stale-token' });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('skips the session check for a legacy token with no sessionId claim', async () => {
    jwtService.verify.mockReturnValue({ sub: 'u1' });

    const context = makeContext({ access_token: 'legacy-token' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(redisService.getActiveSession).not.toHaveBeenCalled();
  });
});
