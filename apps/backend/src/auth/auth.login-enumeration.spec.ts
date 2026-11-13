import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';

jest.mock('argon2', () => {
  const real = jest.requireActual('argon2');
  return { ...real, verify: jest.fn(real.verify) };
});

// Unknown / disabled accounts must be indistinguishable from a wrong password: same hashing work, same lock message.
const verifySpy = argon2.verify as unknown as jest.Mock;

jest.setTimeout(30_000); // real argon2id hashes, slower under a parallel full run

describe('AuthService.validateUser: no account enumeration', () => {
  let attempts: number;
  let service: AuthService;
  let prisma: any;

  beforeEach(() => {
    attempts = 0;
    prisma = { user: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null) } };
    const redis: any = { incrementLoginAttempts: jest.fn(async () => ++attempts), restartLoginAttemptsWindow: jest.fn() };
    const config: any = { get: jest.fn((_k: string, d: number) => d) };
    const settings: any = { getLockoutPolicy: jest.fn().mockResolvedValue({ maxAttempts: 5, durationMinutes: 15 }) };
    service = new AuthService(prisma, {} as any, redis, config, {} as any, settings, { getActive: jest.fn().mockResolvedValue(null), lock: jest.fn() } as any);
    verifySpy.mockClear();
  });

  it('does the password-hash work for an unknown user', async () => {
    await expect(service.validateUser('ghost', 'x', 'ip', 'ua')).rejects.toThrow('Invalid credentials');
    expect(verifySpy).toHaveBeenCalledTimes(1);
  });

  it('does the password-hash work for a disabled user', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u', username: 'off', isActive: false, passwordHash: 'h' });
    await expect(service.validateUser('off', 'x', 'ip', 'ua')).rejects.toThrow('Invalid credentials');
    expect(verifySpy).toHaveBeenCalledTimes(1);
  });

  it('reports the lock message for an unknown name after the same number of tries as a real account', async () => {
    for (let i = 0; i < 4; i++) {
      await expect(service.validateUser('ghost', 'x', 'ip', 'ua')).rejects.toThrow('Invalid credentials');
    }
    const err = await service.validateUser('ghost', 'x', 'ip', 'ua').catch((e) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(err.message).toMatch(/temporarily locked/);
  });

  it('does the password-hash work for a locked real account too', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u', username: 'real', isActive: true, passwordHash: 'h' });
    const settings: any = { getLockoutPolicy: jest.fn().mockResolvedValue({ maxAttempts: 5, durationMinutes: 15 }) };
    const locks: any = { getActive: jest.fn().mockResolvedValue({ userId: 'u' }) };
    const svc = new AuthService(prisma, {} as any, {} as any, { get: jest.fn() } as any, {} as any, settings, locks);
    await expect(svc.validateUser('real', 'x', 'ip', 'ua')).rejects.toThrow(/temporarily locked/);
    expect(verifySpy).toHaveBeenCalledTimes(1);
  });
});
