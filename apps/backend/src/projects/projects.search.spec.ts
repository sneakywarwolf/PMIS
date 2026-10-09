import { UserRole } from '@prisma/client';
import { ProjectsService } from './projects.service';

describe('ProjectsService.searchProjects — Ctrl+K scoping', () => {
  const run = async (role: UserRole) => {
    const findMany = jest.fn().mockResolvedValue([]);
    const svc = new ProjectsService({ project: { findMany } } as any, {} as any, {} as any, {} as any);
    await svc.searchProjects({ id: 'u1', role } as any);
    return findMany.mock.calls[0][0];
  };

  it('limits testers to their own projects and returns only display fields', async () => {
    const q = await run(UserRole.TESTER);
    expect(q.where).toEqual({ testerId: 'u1' });
    expect(Object.keys(q.select).sort()).toEqual(['clientName', 'id', 'name', 'scope']);
  });

  it('limits team leads to their team, and leaves admins unrestricted', async () => {
    expect((await run(UserRole.TEAM_LEAD)).where).toEqual({ OR: [{ tlId: 'u1' }, { tester: { assignedTlId: 'u1' } }] });
    expect((await run(UserRole.ADMIN)).where).toEqual({});
  });
});
