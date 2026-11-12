import { DashboardService } from './dashboard.service';

// The activity feed shows who, what and when. The stored request body (details), IP address and browser are Admin-only:
// an AVP's feed spans teams, although an AVP cannot open other teams' projects.
describe('DashboardService.getRecentActivity: field minimisation', () => {
  const setup = () => {
    const prisma: any = { auditLog: { findMany: jest.fn().mockResolvedValue([]) }, user: { findMany: jest.fn().mockResolvedValue([{ id: 't1' }]) } };
    return { prisma, svc: new (DashboardService as any)(prisma) as DashboardService };
  };
  const call = (prisma: any) => prisma.auditLog.findMany.mock.calls[0][0];

  it.each(['AVP', 'TEAM_LEAD', 'TESTER'])('%s gets no details, IP address, user agent or target id', async (role) => {
    const { svc, prisma } = setup();
    await svc.getRecentActivity(15, { id: 'u1', role } as any);
    const q = call(prisma);
    expect(q.include).toBeUndefined();
    expect(Object.keys(q.select).sort()).toEqual(['action', 'actor', 'id', 'targetType', 'timestamp']);
  });

  it('Admin still gets the full audit row', async () => {
    const { svc, prisma } = setup();
    await svc.getRecentActivity(15, { id: 'a1', role: 'ADMIN' } as any);
    expect(call(prisma).select).toBeUndefined();
    expect(call(prisma).include.actor).toBeDefined();
  });
});
