import { UserRole } from '@prisma/client';
import { UsersService } from './users.service';

describe('UsersService.getMyTeam', () => {
  const lead = { id: 'tl', fullName: 'Lead L', username: 'lead', designation: 'Senior', manager: { id: 'm', fullName: 'Mgr', username: 'mgr', designation: null } };
  const members = [
    { id: 't1', fullName: 'Tester One', username: 't1', designation: 'Analyst' },
    { id: 't2', fullName: null, username: 'tester2', designation: null },
  ];

  const svc = (leadRow: any = lead, memberRows: any[] = members) => {
    const prisma: any = { user: { findUnique: jest.fn().mockResolvedValue(leadRow), findMany: jest.fn().mockResolvedValue(memberRows) } };
    return { service: new UsersService(prisma, {} as any, {} as any, {} as any, {} as any), prisma };
  };

  it('shows a tester their own lead, manager and teammates (names/designations only), marking themselves', async () => {
    const { service, prisma } = svc();
    const team = await service.getMyTeam({ id: 't1', role: UserRole.TESTER, assignedTlId: 'tl' });

    expect(team!.teamLead).toEqual({ id: 'tl', name: 'Lead L', designation: 'Senior' });
    expect(team!.manager!.name).toBe('Mgr');
    expect(team!.members.map((m) => [m.name, m.isMe])).toEqual([['Tester One', true], ['tester2', false]]);
    // scoped to the caller's own lead, active members, and no contact fields requested
    expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({ assignedTlId: 'tl', isActive: true });
    expect(JSON.stringify(prisma.user.findMany.mock.calls[0][0].select)).not.toMatch(/email|phone/);
  });

  it('returns null for a tester with no team lead', async () => {
    expect(await svc().service.getMyTeam({ id: 't1', role: UserRole.TESTER, assignedTlId: null })).toBeNull();
  });

  it('returns null for a lead-type user with nobody assigned', async () => {
    expect(await svc(lead, []).service.getMyTeam({ id: 'tl', role: UserRole.TEAM_LEAD, assignedTlId: null })).toBeNull();
  });
});
