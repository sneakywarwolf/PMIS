import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { DashboardController } from './dashboard.controller';

function makeUser(overrides: any) {
  return { id: 'user-1', role: UserRole.TESTER, assignedTlId: null, ...overrides };
}

describe('DashboardController.getCompletionStats', () => {
  let service: {
    getSelfCompletionStats: jest.Mock;
    getTeamCompletionStats: jest.Mock;
    getOrgCompletionStats: jest.Mock;
  };
  let controller: DashboardController;

  beforeEach(() => {
    service = {
      getSelfCompletionStats: jest.fn().mockResolvedValue({ totalCompleted: 0 }),
      getTeamCompletionStats: jest.fn().mockResolvedValue({ totalCompleted: 0 }),
      getOrgCompletionStats: jest.fn().mockResolvedValue({ totalCompleted: 0 }),
    };
    controller = new DashboardController(service as any);
  });

  it('scope=self always uses the caller\'s own id, ignoring any tlId param', async () => {
    const user = makeUser({ id: 'tester-1' });
    await controller.getCompletionStats({ scope: 'self', granularity: 'month', tlId: 'someone-else' } as any, user as any);
    expect(service.getSelfCompletionStats).toHaveBeenCalledWith('tester-1', 'month');
  });

  it('scope=org rejects a TESTER with ForbiddenException', async () => {
    const user = makeUser({ role: UserRole.TESTER });
    await expect(
      controller.getCompletionStats({ scope: 'org', granularity: 'month' } as any, user as any),
    ).rejects.toThrow(ForbiddenException);
    expect(service.getOrgCompletionStats).not.toHaveBeenCalled();
  });

  it('scope=org allows ADMIN', async () => {
    const user = makeUser({ role: UserRole.ADMIN });
    await controller.getCompletionStats({ scope: 'org', granularity: 'quarter' } as any, user as any);
    expect(service.getOrgCompletionStats).toHaveBeenCalledWith('quarter');
  });

  it('scope=team with no tlId resolves a TEAM_LEAD\'s own team', async () => {
    const user = makeUser({ id: 'tl-1', role: UserRole.TEAM_LEAD });
    await controller.getCompletionStats({ scope: 'team', granularity: 'week' } as any, user as any);
    expect(service.getTeamCompletionStats).toHaveBeenCalledWith('tl-1', 'week', true);
  });

  it('scope=team with no tlId resolves a TESTER\'s assigned team', async () => {
    const user = makeUser({ id: 'tester-1', role: UserRole.TESTER, assignedTlId: 'tl-9' });
    await controller.getCompletionStats({ scope: 'team', granularity: 'month' } as any, user as any);
    expect(service.getTeamCompletionStats).toHaveBeenCalledWith('tl-9', 'month', true);
  });

  it('scope=team with a foreign tlId (cross-team explorer) requests aggregate-only', async () => {
    const user = makeUser({ id: 'tester-1', role: UserRole.TESTER, assignedTlId: 'tl-9' });
    await controller.getCompletionStats({ scope: 'team', granularity: 'month', tlId: 'tl-other' } as any, user as any);
    expect(service.getTeamCompletionStats).toHaveBeenCalledWith('tl-other', 'month', false);
  });
});
