import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { NotificationType, UserRole } from '@prisma/client';
import { ProjectsService } from './projects.service';

describe('ProjectsService.reassign', () => {
  const project = { id: 'p1', name: 'Acme VAPT', clientName: 'Acme', testerId: 't1', tlId: 'tl1', tester: { assignedTlId: 'tl1' } };
  const tester = (over: object = {}) => ({ id: 't2', role: UserRole.TESTER, isActive: true, deletedAt: null, assignedTlId: 'tl1', ...over });

  const setup = (proj: any, newTester: any) => {
    const prisma = {
      project: { findUnique: jest.fn().mockResolvedValue(proj), update: jest.fn().mockResolvedValue({ tester: {}, tl: {} }) },
      user: { findUnique: jest.fn().mockResolvedValue(newTester) },
    };
    const audit = { log: jest.fn() };
    const notifications = { create: jest.fn().mockResolvedValue({}) };
    const svc = new ProjectsService(prisma as any, audit as any, {} as any, notifications as any);
    return { svc, prisma, audit, notifications };
  };
  const run = (svc: ProjectsService, actor: any, testerId = 't2') =>
    svc.reassign('p1', { testerId }, actor, 'ip', 'ua');

  it('lets a TL move a project to a tester on their own team, follows the team, and notifies the tester', async () => {
    const { svc, prisma, notifications, audit } = setup(project, tester());
    await run(svc, { id: 'tl1', role: UserRole.TEAM_LEAD });
    expect(prisma.project.update.mock.calls[0][0].data).toEqual({ testerId: 't2', tlId: 'tl1' });
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 't2', type: NotificationType.PROJECT_ASSIGNED, relatedId: 'p1' }));
    expect(audit.log).toHaveBeenCalled();
  });

  it('rejects a TL assigning to a tester outside their team', async () => {
    const { svc, prisma, notifications } = setup(project, tester({ assignedTlId: 'tl2' }));
    await expect(run(svc, { id: 'tl1', role: UserRole.TEAM_LEAD })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.project.update).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it("rejects a TL touching another team's project", async () => {
    const { svc } = setup({ ...project, tlId: 'tl2', tester: { assignedTlId: 'tl2' } }, tester());
    await expect(run(svc, { id: 'tl1', role: UserRole.TEAM_LEAD })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets an admin assign across teams and moves the project to the new tester team', async () => {
    const { svc, prisma } = setup(project, tester({ assignedTlId: 'tl2' }));
    await run(svc, { id: 'admin', role: UserRole.ADMIN });
    expect(prisma.project.update.mock.calls[0][0].data).toEqual({ testerId: 't2', tlId: 'tl2' });
  });

  it.each([
    ['not a tester', { role: UserRole.TEAM_LEAD }],
    ['inactive', { isActive: false }],
    ['deleted', { deletedAt: new Date() }],
    ['missing', null],
  ])('rejects an assignee that is %s', async (_n, over) => {
    const { svc } = setup(project, over === null ? null : tester(over as object));
    await expect(run(svc, { id: 'admin', role: UserRole.ADMIN })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects reassigning to the current tester and unknown projects', async () => {
    const same = setup(project, tester({ id: 't1' }));
    await expect(run(same.svc, { id: 'admin', role: UserRole.ADMIN }, 't1')).rejects.toBeInstanceOf(BadRequestException);
    const none = setup(null, tester());
    await expect(run(none.svc, { id: 'admin', role: UserRole.ADMIN })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('still succeeds when the notification fails', async () => {
    const { svc, notifications } = setup(project, tester());
    notifications.create.mockRejectedValue(new Error('down'));
    await expect(run(svc, { id: 'tl1', role: UserRole.TEAM_LEAD })).resolves.toMatchObject({ message: 'Project reassigned successfully' });
  });
});
