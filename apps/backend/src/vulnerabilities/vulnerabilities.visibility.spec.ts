import { NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { VulnerabilitiesService } from './vulnerabilities.service';

describe('single vulnerability visibility (GET /vulnerabilities/:id and its history)', () => {
  const rows: Record<string, any> = {
    approved: { id: 'approved', status: 'APPROVED', isActive: true, requestedById: 'u-req' },
    pending: { id: 'pending', status: 'PENDING', isActive: true, requestedById: 'u-req' },
    rejected: { id: 'rejected', status: 'REJECTED', isActive: true, requestedById: 'u-req' },
    inactive: { id: 'inactive', status: 'APPROVED', isActive: false, requestedById: null },
  };
  const make = () => {
    const prisma: any = {
      vulnerability: { findUnique: jest.fn(async ({ where }: any) => rows[where.id] ?? null) },
      auditLog: { findMany: jest.fn(async () => [{ id: 'log' }]) },
    };
    return { svc: new VulnerabilitiesService(prisma, {} as any, {} as any), prisma };
  };
  const as = (role: UserRole, id = 'someone') => ({ id, role });

  it.each([UserRole.ADMIN, UserRole.AVP, UserRole.TEAM_LEAD])('%s can open any record, including pending, rejected and deactivated', async (role) => {
    const { svc } = make();
    for (const id of Object.keys(rows)) await expect(svc.findOne(id, as(role))).resolves.toMatchObject({ id });
  });

  it('a Tester sees approved records, and only their own unapproved request', async () => {
    const { svc } = make();
    await expect(svc.findOne('approved', as(UserRole.TESTER))).resolves.toBeDefined();
    await expect(svc.findOne('pending', as(UserRole.TESTER, 'u-req'))).resolves.toBeDefined(); // the requester
    for (const id of ['pending', 'rejected', 'inactive']) {
      await expect(svc.findOne(id, as(UserRole.TESTER, 'u-other'))).rejects.toBeInstanceOf(NotFoundException);
    }
  });

  it('answers a hidden record exactly like a missing one (no existence oracle)', async () => {
    const { svc } = make();
    const hidden = await svc.findOne('pending', as(UserRole.TESTER, 'u-other')).catch((e) => e.message);
    const missing = await svc.findOne('nope', as(UserRole.TESTER, 'u-other')).catch((e) => e.message);
    expect(hidden).toBe(missing);
  });

  it('the audit history is only as visible as the record: no log is read for a hidden record', async () => {
    const { svc, prisma } = make();
    await expect(svc.getHistory('pending', as(UserRole.TESTER, 'u-other'))).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
    await expect(svc.getHistory('pending', as(UserRole.TEAM_LEAD))).resolves.toEqual([{ id: 'log' }]);
    await expect(svc.getHistory('approved', as(UserRole.TESTER, 'u-other'))).resolves.toEqual([{ id: 'log' }]);
  });
});
