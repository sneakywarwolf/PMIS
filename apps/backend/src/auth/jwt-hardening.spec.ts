import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { verifyAccessToken } from './verify-access-token';

describe('access-token verification', () => {
  const secret = 'a'.repeat(40);
  const jwt = new JwtService({});
  const redis: any = { getActiveSession: jest.fn().mockResolvedValue('s1'), isSessionActive: jest.fn().mockResolvedValue(true), touchSessionActivity: jest.fn() };
  const prisma: any = { user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', username: 'u', role: 'TESTER', isActive: true, isForcePasswordChange: false }) } };
  const sign = (payload: any, opts: any = {}) => jwt.sign(payload, { secret, expiresIn: 60, ...opts });
  const run = (token: string) => verifyAccessToken(token, jwt, redis, prisma);
  beforeAll(() => { process.env.JWT_ACCESS_SECRET = secret; });

  it('accepts a normal HS256 access token', async () => {
    await expect(run(sign({ sub: 'u1', sessionId: 's1' }))).resolves.toMatchObject({ id: 'u1' });
  });

  it('rejects a refresh token (it carries a jti) even when signed with the access secret', async () => {
    await expect(run(sign({ sub: 'u1', sessionId: 's1', jti: 'r1' }))).rejects.toThrow(UnauthorizedException);
  });

  it('rejects other algorithms, the unsigned "none" token and a wrong secret', async () => {
    await expect(run(sign({ sub: 'u1', sessionId: 's1' }, { algorithm: 'HS512' }))).rejects.toThrow(UnauthorizedException);
    const none = Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url') + '.' + Buffer.from('{"sub":"u1","sessionId":"s1"}').toString('base64url') + '.';
    await expect(run(none)).rejects.toThrow(UnauthorizedException);
    await expect(run(sign({ sub: 'u1', sessionId: 's1' }, { secret: 'b'.repeat(40) }))).rejects.toThrow(UnauthorizedException);
  });

  it('fails closed (no default secret) when the secret is not configured', async () => {
    const token = sign({ sub: 'u1', sessionId: 's1' });
    const saved = process.env.JWT_ACCESS_SECRET;
    delete process.env.JWT_ACCESS_SECRET;
    try { await expect(run(token)).rejects.toThrow(UnauthorizedException); } finally { process.env.JWT_ACCESS_SECRET = saved; }
  });
});
