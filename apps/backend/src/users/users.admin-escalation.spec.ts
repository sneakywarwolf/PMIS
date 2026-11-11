import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { UsersService } from './users.service';

// An Admin can delegate user management to other roles in Settings > RBAC. That must not reach Admin accounts.
describe('delegated user management cannot reach Admin accounts', () => {
  const adminRow = { id: 'adm', role: UserRole.ADMIN, username: 'root', isActive: true };
  const testerRow = { id: 't1', role: UserRole.TESTER, username: 't', isActive: true };
  let prisma: any;
  let svc: UsersService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(async ({ where }: any) => (where.id === 'adm' ? adminRow : where.id === 't1' ? testerRow : null)),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    svc = new UsersService(prisma, { log: jest.fn() } as any, {} as any, {} as any, { revokeAllUserTokens: jest.fn(), clearActiveSession: jest.fn() } as any);
  });

  it.each([UserRole.TEAM_LEAD, UserRole.AVP, UserRole.TESTER])('%s cannot reset, deactivate or edit an Admin', async (role) => {
    await expect(svc.forcePasswordReset('adm', 'x', 'ip', 'ua', role)).rejects.toThrow(ForbiddenException);
    await expect(svc.softDelete('adm', 'x', 'ip', 'ua', role)).rejects.toThrow(ForbiddenException);
    await expect(svc.update('adm', { email: 'a@b.co' } as any, 'x', 'ip', 'ua', role)).rejects.toThrow(ForbiddenException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('a non-admin cannot create an Admin or promote anyone (including themselves) to Admin', async () => {
    await expect(svc.create({ username: 'n', email: 'n@x.co', role: UserRole.ADMIN } as any, 'x', 'ip', 'ua', UserRole.TEAM_LEAD)).rejects.toThrow(ForbiddenException);
    await expect(svc.update('t1', { role: UserRole.ADMIN } as any, 't1', 'ip', 'ua', UserRole.TESTER)).rejects.toThrow(ForbiddenException);
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('a non-admin cannot change their own role', async () => {
    await expect(svc.update('t1', { role: UserRole.AVP } as any, 't1', 'ip', 'ua', UserRole.TESTER)).rejects.toThrow(ForbiddenException);
  });

  it('a Team Lead can only manage Testers of their own team, and only as Testers', async () => {
    prisma.user.findUnique.mockImplementation(async ({ where }: any) => ({
      adm: adminRow,
      mine: { id: 'mine', role: UserRole.TESTER, assignedTlId: 'tl1' },
      theirs: { id: 'theirs', role: UserRole.TESTER, assignedTlId: 'tl2' },
      peer: { id: 'peer', role: UserRole.TEAM_LEAD, assignedTlId: null },
    } as any)[where.id] ?? null);
    for (const id of ['theirs', 'peer']) {
      await expect(svc.forcePasswordReset(id, 'tl1', 'ip', 'ua', UserRole.TEAM_LEAD)).rejects.toThrow(ForbiddenException);
      await expect(svc.softDelete(id, 'tl1', 'ip', 'ua', UserRole.TEAM_LEAD)).rejects.toThrow(ForbiddenException);
      await expect(svc.update(id, { email: 'a@b.co' } as any, 'tl1', 'ip', 'ua', UserRole.TEAM_LEAD)).rejects.toThrow(ForbiddenException);
    }
    await expect(svc.update('mine', { role: UserRole.AVP } as any, 'tl1', 'ip', 'ua', UserRole.TEAM_LEAD)).rejects.toThrow(ForbiddenException);
    await expect(svc.update('mine', { assignedTlId: 'tl2' } as any, 'tl1', 'ip', 'ua', UserRole.TEAM_LEAD)).rejects.toThrow(ForbiddenException);
    await expect(svc.create({ username: 'n', email: 'n@x.co', role: UserRole.TESTER, assignedTlId: 'tl2' } as any, 'tl1', 'ip', 'ua', UserRole.TEAM_LEAD)).rejects.toThrow(ForbiddenException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('fails closed when the caller role is not supplied', async () => {
    await expect(svc.forcePasswordReset('adm', 'x', 'ip', 'ua')).rejects.toThrow(ForbiddenException);
  });
});
