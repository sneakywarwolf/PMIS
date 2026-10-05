import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../prisma/prisma.service';

describe('DashboardService.getEngagements', () => {
  let service: DashboardService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      project: { findMany: jest.fn().mockResolvedValue([{ id: 'p1' }]) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 't1' }, { id: 't2' }]) },
      finding: {
        findMany: jest.fn().mockResolvedValue([
          { projectId: 'p1', vulnerability: { severity: 'High' } },
          { projectId: 'p1', vulnerability: { severity: 'Informational' } },
          { projectId: 'p1', vulnerability: { severity: 'high' } },
        ]),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [DashboardService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(DashboardService);
  });

  const whereOf = () => prisma.project.findMany.mock.calls[0][0].where;

  it('ADMIN/AVP are unscoped', async () => {
    await service.getEngagements({ id: 'a', role: UserRole.ADMIN, assignedTlId: null }, 'self');
    expect(whereOf()).toEqual({});
  });

  it('tester self view only sees own projects', async () => {
    await service.getEngagements({ id: 't1', role: UserRole.TESTER, assignedTlId: 'tl' }, 'self');
    expect(whereOf()).toEqual({ OR: [{ testerId: 't1' }, { tlId: 't1' }] });
  });

  it('tester team view is scoped to their TL\'s team', async () => {
    await service.getEngagements({ id: 't1', role: UserRole.TESTER, assignedTlId: 'tl' }, 'team');
    expect(prisma.user.findMany).toHaveBeenCalledWith({ where: { assignedTlId: 'tl' }, select: { id: true } });
    expect(whereOf()).toEqual({ OR: [{ tlId: 'tl' }, { testerId: { in: ['t1', 't2'] } }] });
  });

  it('counts severities case-insensitively and folds Informational into info', async () => {
    const [row] = await service.getEngagements({ id: 'a', role: UserRole.ADMIN, assignedTlId: null }, 'team');
    expect(row.vulnCounts).toEqual({ critical: 0, high: 2, medium: 0, low: 0, info: 1 });
  });
});
