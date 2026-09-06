import { Test } from '@nestjs/testing';
import { ComplianceType, ProjectStatus, UserRole } from '@prisma/client';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../prisma/prisma.service';

function project(overrides: any) {
  return {
    id: 'p1',
    name: 'Proj',
    status: ProjectStatus.COMPLETED,
    complianceType: ComplianceType.VAPT,
    endDate: new Date('2026-08-01'),
    testerId: 'tester-1',
    tlId: 'tl-1',
    ...overrides,
  };
}

describe('DashboardService.completion stats', () => {
  let service: DashboardService;
  let prisma: { project: { findMany: jest.Mock }; user: { findMany: jest.Mock; findUnique: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      project: { findMany: jest.fn() },
      user: { findMany: jest.fn(), findUnique: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [DashboardService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(DashboardService);
  });

  it('getSelfCompletionStats only queries the caller\'s own completed projects', async () => {
    prisma.project.findMany.mockResolvedValue([project({ id: 'p1' })]);

    const result = await service.getSelfCompletionStats('tester-1', 'month');

    expect(prisma.project.findMany).toHaveBeenCalledWith({
      where: { testerId: 'tester-1', status: ProjectStatus.COMPLETED },
      select: { id: true, name: true, complianceType: true, endDate: true },
    });
    expect(result.totalCompleted).toBe(1);
  });

  it('getTeamCompletionStats returns zeroed stats for a tlId that is not a real TEAM_LEAD', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const result = await service.getTeamCompletionStats('not-a-tl', 'month', true);

    expect(prisma.project.findMany).not.toHaveBeenCalled();
    expect(result.totalCompleted).toBe(0);
    expect(result.members).toEqual([]);
  });

  it('getTeamCompletionStats omits members when includeMembers is false (cross-team explorer)', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'tl-1', role: UserRole.TEAM_LEAD, username: 'tl1' });
    prisma.user.findMany.mockResolvedValue([{ id: 'tester-1', username: 'tester1' }]);
    prisma.project.findMany.mockResolvedValue([project({ id: 'p1' })]);

    const result = await service.getTeamCompletionStats('tl-1', 'month', false);

    expect(result.members).toBeUndefined();
    expect(result.totalCompleted).toBe(1);
  });

  it('getTeamCompletionStats includes per-member breakdown when includeMembers is true', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'tl-1', role: UserRole.TEAM_LEAD, username: 'tl1' });
    prisma.user.findMany.mockResolvedValue([{ id: 'tester-1', username: 'tester1' }]);
    prisma.project.findMany.mockResolvedValue([project({ id: 'p1', testerId: 'tester-1' })]);

    const result = await service.getTeamCompletionStats('tl-1', 'month', true);

    expect(result.members).toEqual([
      { id: 'tester-1', username: 'tester1', totalCompleted: 1, byType: { VAPT: 1, CERT_IN: 0, PCI: 0, ASV: 0 } },
    ]);
  });

  it('getOrgCompletionStats aggregates totals per team', async () => {
    prisma.user.findMany
      .mockResolvedValueOnce([{ id: 'tl-1', username: 'tl1' }]) // all TLs
      .mockResolvedValueOnce([{ id: 'tester-1', username: 'tester1' }]); // testers under tl-1
    prisma.project.findMany.mockResolvedValue([project({ id: 'p1', tlId: 'tl-1' })]);

    const result = await service.getOrgCompletionStats('month');

    expect(result.totalCompleted).toBe(1);
    expect(result.teams).toEqual([
      { tlId: 'tl-1', tlName: 'tl1', teamSize: 1, totalCompleted: 1, byType: { VAPT: 1, CERT_IN: 0, PCI: 0, ASV: 0 } },
    ]);
  });
});
