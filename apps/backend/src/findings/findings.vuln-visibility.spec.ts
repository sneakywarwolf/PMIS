import { NotFoundException } from '@nestjs/common';
import { FindingsService } from './findings.service';

// A library entry that is pending, rejected or retired belongs to whoever requested it and to reviewers. Attaching its id to a
// finding must not hand its content to anyone else (the response includes the joined vulnerability).
describe('FindingsService.create: library visibility of vulnId', () => {
  const project = { id: 'p1', subType: 'WEB', testerId: 'me', tlId: null, status: 'IN_PROGRESS', tester: { assignedTlId: null } };
  const setup = (vuln: any) => {
    const prisma: any = {
      project: { findUnique: jest.fn().mockResolvedValue(project), update: jest.fn() },
      vulnerability: { findUnique: jest.fn().mockResolvedValue(vuln) },
      finding: { create: jest.fn(async ({ data }: any) => ({ id: 'f1', ...data, vulnerability: { name: 'SECRET' }, projectVulnerability: null })) },
    };
    return { prisma, svc: new FindingsService(prisma, { log: jest.fn() } as any, {} as any) };
  };
  const tester: any = { id: 'me', role: 'TESTER' };
  const body = (vulnId: any) => ({ projectId: 'p1', vulnId, testerNotes: 'n' });

  it('refuses another tester\'s pending, rejected or retired entry', async () => {
    for (const v of [{ status: 'PENDING', isActive: true, requestedById: 'other' }, { status: 'REJECTED', isActive: true, requestedById: 'other' }, { status: 'APPROVED', isActive: false, requestedById: 'other' }]) {
      const { svc, prisma } = setup(v);
      await expect(svc.create(body('v1'), tester, 'ip', 'ua')).rejects.toThrow(NotFoundException);
      expect(prisma.finding.create).not.toHaveBeenCalled();
    }
  });

  it('refuses an unknown id and a non-string id (object injection)', async () => {
    await expect(setup(null).svc.create(body('missing'), tester, 'ip', 'ua')).rejects.toThrow(NotFoundException);
    await expect(setup({}).svc.create(body({ not: 'a string' }), tester, 'ip', 'ua')).rejects.toThrow(NotFoundException);
  });

  it('allows a published entry, the requester\'s own pending entry, and an Admin', async () => {
    await expect(setup({ status: 'APPROVED', isActive: true, requestedById: 'other' }).svc.create(body('v1'), tester, 'ip', 'ua')).resolves.toBeDefined();
    await expect(setup({ status: 'PENDING', isActive: true, requestedById: 'me' }).svc.create(body('v1'), tester, 'ip', 'ua')).resolves.toBeDefined();
    await expect(setup({ status: 'PENDING', isActive: true, requestedById: 'other' }).svc.create(body('v1'), { id: 'me', role: 'ADMIN' } as any, 'ip', 'ua')).resolves.toBeDefined();
  });
});
