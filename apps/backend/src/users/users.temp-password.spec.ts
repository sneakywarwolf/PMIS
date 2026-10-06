import { UsersService } from './users.service';

function makeService(security: { passwordMinLength: number; passwordRequireComplexity: boolean }) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 'u1' }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const settings = { get: jest.fn().mockResolvedValue({ settings: { security } }) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new UsersService(prisma as any, audit as any, {} as any, settings as any);
  return { service, prisma };
}

describe('UsersService.forcePasswordReset temp password', () => {
  it.each([8, 10, 14, 32])('uses the admin-configured length (%i)', async (len) => {
    const { service } = makeService({ passwordMinLength: len, passwordRequireComplexity: true });
    const { tempPassword } = await service.forcePasswordReset('u1', 'admin', 'ip', 'ua');
    expect(tempPassword).toHaveLength(len);
  });

  it('includes every character class when complexity is required', async () => {
    const { service } = makeService({ passwordMinLength: 8, passwordRequireComplexity: true });
    // 8 = the smallest allowed policy length, so only the guaranteed picks plus 4 random chars
    for (let i = 0; i < 50; i++) {
      const { tempPassword: p } = await service.forcePasswordReset('u1', 'admin', 'ip', 'ua');
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[0-9]/);
      expect(p).toMatch(/[^a-zA-Z0-9]/);
    }
  });

  it('still hashes and stores the generated password with the force-change flag', async () => {
    const { service, prisma } = makeService({ passwordMinLength: 10, passwordRequireComplexity: false });
    const { tempPassword } = await service.forcePasswordReset('u1', 'admin', 'ip', 'ua');
    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data.isForcePasswordChange).toBe(true);
    expect(data.passwordHash).not.toContain(tempPassword);
  });
});
