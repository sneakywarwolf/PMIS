import { AuthService } from './auth.service';

jest.setTimeout(30_000);

// A password change must end every earlier session (a stolen access token stops working) and give the caller a new one.
describe('AuthService.changePassword: session handling', () => {
  it('revokes tokens, clears the old session, and signs the caller in on a fresh one', async () => {
    const calls: string[] = [];
    const redis: any = {
      revokeAllUserTokens: jest.fn(async () => { calls.push('revokeAll'); }),
      getActiveSession: jest.fn(async () => 'old-session'),
      clearSessionActivity: jest.fn(async (id: string) => { calls.push(`clearActivity:${id}`); }),
      clearActiveSession: jest.fn(async () => { calls.push('clearActive'); }),
      storeRefreshToken: jest.fn(),
      setActiveSession: jest.fn(async (_u: string, id: string) => { calls.push(`setActive:${id}`); }),
      touchSessionActivity: jest.fn(),
    };
    const prisma: any = { user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', username: 'u', role: 'TESTER', assignedTlId: null, isForcePasswordChange: true, passwordHash: 'x' }), update: jest.fn() } };
    const jwt: any = { sign: jest.fn().mockReturnValue('signed') };
    const settings: any = { validatePassword: jest.fn().mockResolvedValue([]), get: jest.fn().mockResolvedValue({ settings: { security: { sessionTimeoutMinutes: 15 } } }) };
    const svc = new AuthService(prisma, jwt, redis, { get: jest.fn() } as any, { log: jest.fn() } as any, settings);

    const result = await svc.changePassword('u1', { newPassword: 'A-Long-New-Passw0rd!' } as any, 'ip', 'ua');

    expect(calls.slice(0, 3)).toEqual(['revokeAll', 'clearActivity:old-session', 'clearActive']);
    const newSession = calls.find((c) => c.startsWith('setActive:'))!.split(':')[1];
    expect(newSession).not.toBe('old-session');
    expect(result.access_token).toBe('signed');
    expect(result.user.isForcePasswordChange).toBe(false);
  });
});
