import { NotificationsService } from '../notifications/notifications.service';
import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { UserRole, ProjectStatus } from '@prisma/client';
import { ProjectsService } from './projects.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { ProjectPurgeService } from '../common/project-purge.service';

function project(overrides: any = {}) {
  return {
    id: 'p1',
    testerId: 'tester-1',
    tlId: 'tl-1',
    status: ProjectStatus.IN_PROGRESS,
    startDate: new Date('2026-01-01T00:00:00.000Z'),
    tester: { id: 'tester-1', assignedTlId: 'tl-1' },
    tl: { id: 'tl-1' },
    ...overrides,
  };
}

function actor(role: UserRole, id: string) {
  return { id, role } as any;
}

describe('ProjectsService.update — start date editing', () => {
  let service: ProjectsService;
  let prisma: { project: { findUnique: jest.Mock; update: jest.Mock } };
  let audit: { log: jest.Mock };

  beforeEach(async () => {
    prisma = {
      project: { findUnique: jest.fn(), update: jest.fn() },
    };
    audit = { log: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: SettingsService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        { provide: ProjectPurgeService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(ProjectsService);
  });

  it('rejects a start date edit from a non-tester (e.g. TL)', async () => {
    prisma.project.findUnique.mockResolvedValue(project());

    await expect(
      service.update('p1', { startDate: '2026-02-01' } as any, actor(UserRole.TEAM_LEAD, 'tl-1'), '1.2.3.4', 'jest'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('sets startDateChangedAt when the assigned tester actually changes the start date', async () => {
    prisma.project.findUnique.mockResolvedValue(project());
    prisma.project.update.mockResolvedValue({ id: 'p1' });

    await service.update('p1', { startDate: '2026-02-01' } as any, actor(UserRole.TESTER, 'tester-1'), '1.2.3.4', 'jest');

    const updateArg = prisma.project.update.mock.calls[0][0];
    expect(updateArg.data.startDateChangedAt).toBeInstanceOf(Date);
  });

  it('does not set startDateChangedAt when the tester resubmits the same start date', async () => {
    prisma.project.findUnique.mockResolvedValue(project());
    prisma.project.update.mockResolvedValue({ id: 'p1' });

    await service.update('p1', { startDate: '2026-01-01' } as any, actor(UserRole.TESTER, 'tester-1'), '1.2.3.4', 'jest');

    const updateArg = prisma.project.update.mock.calls[0][0];
    expect(updateArg.data.startDateChangedAt).toBeUndefined();
  });
});

describe('ProjectsService.remove', () => {
  let service: ProjectsService;
  let audit: { log: jest.Mock };
  let projectPurge: { loadPurgeableProject: jest.Mock; purgeProject: jest.Mock };

  beforeEach(async () => {
    audit = { log: jest.fn() };
    projectPurge = { loadPurgeableProject: jest.fn(), purgeProject: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: {} },
        { provide: AuditService, useValue: audit },
        { provide: SettingsService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        { provide: ProjectPurgeService, useValue: projectPurge },
      ],
    }).compile();
    service = moduleRef.get(ProjectsService);
  });

  it('purges the project and logs a PROJECT_DELETED audit entry', async () => {
    projectPurge.loadPurgeableProject.mockResolvedValue({ id: 'p1' });
    projectPurge.purgeProject.mockResolvedValue({ filesDeleted: 3 });

    const result = await service.remove('p1', 'admin-1', '1.2.3.4', 'jest');

    expect(projectPurge.purgeProject).toHaveBeenCalledWith({ id: 'p1' });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'admin-1', action: 'PROJECT_DELETED', targetId: 'p1', details: { filesDeleted: 3 } }),
    );
    expect(result.filesDeleted).toBe(3);
  });

  it('throws NotFoundException when the project does not exist', async () => {
    projectPurge.loadPurgeableProject.mockResolvedValue(null);

    await expect(service.remove('missing', 'admin-1', '1.2.3.4', 'jest')).rejects.toThrow('Project not found');
    expect(projectPurge.purgeProject).not.toHaveBeenCalled();
  });
});

describe('ProjectsService.update — completed projects', () => {
  let service: ProjectsService;
  let prisma: any;
  let audit: { log: jest.Mock };
  const done = (o: any = {}) => project({ status: ProjectStatus.COMPLETED, name: 'Old', clientName: 'Acme', scope: 'S', location: null, customFieldValues: { a: '1' }, endDate: new Date('2026-03-01T00:00:00.000Z'), generatedAt: new Date('2026-02-01'), ...o });
  const tester = { id: 'tester-1', role: UserRole.TESTER, username: 'tess', fullName: null } as any;

  beforeEach(async () => {
    prisma = {
      project: { findUnique: jest.fn(), update: jest.fn(async ({ data }) => ({ id: 'p1', name: data.name ?? 'Old', ...data })), },
      projectChange: { createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn(),
    };
    prisma.$transaction = jest.fn((fn: any) => fn(prisma));
    audit = { log: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: NotificationsService, useValue: {} },
        { provide: ProjectPurgeService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(ProjectsService);
  });

  const edit = (dto: any, who = tester) => {
    prisma.project.findUnique.mockResolvedValue(done());
    return service.update('p1', dto, who, '1.2.3.4', 'jest');
  };

  it('lets the owning tester edit, records only real changes with old/new values and the actor', async () => {
    await edit({ name: 'New', clientName: 'Acme', scope: 'S', location: '', endDate: '2026-03-01', customFieldValues: { a: '2' } });

    const data = prisma.project.update.mock.calls[0][0].data;
    expect(data).toEqual({ name: 'New', customFieldValues: { a: '2' } });
    const rows = prisma.projectChange.createMany.mock.calls[0][0].data;
    expect(rows.map((r: any) => [r.field, r.oldValue, r.newValue])).toEqual([
      ['name', 'Old', 'New'],
      ['customFieldValues.a', '1', '2'],
    ]);
    expect(rows[0]).toMatchObject({ projectId: 'p1', projectName: 'New', changedById: 'tester-1', changedByName: 'tess' });
  });

  it('never touches status, completion date or reports, and a no-op save writes nothing', async () => {
    await edit({ name: 'New' });
    const data = prisma.project.update.mock.calls[0][0].data;
    for (const k of ['status', 'generatedAt', 'reportDocxPath', 'reportPdfPath']) expect(data).not.toHaveProperty(k);

    prisma.project.update.mockClear();
    prisma.projectChange.createMany.mockClear();
    await edit({ name: 'Old', clientName: 'Acme', scope: 'S', location: '', endDate: '2026-03-01', customFieldValues: { a: '1' } });
    expect(prisma.project.update).not.toHaveBeenCalled();
    expect(prisma.projectChange.createMany).not.toHaveBeenCalled();
  });

  it('keeps a chronological row per edit instead of overwriting earlier history', async () => {
    await edit({ name: 'B' });
    await edit({ name: 'C' });
    expect(prisma.projectChange.createMany).toHaveBeenCalledTimes(2);
  });

  it('still denies users without access, including direct API calls', async () => {
    await expect(edit({ name: 'X' }, { id: 'other', role: UserRole.TESTER } as any)).rejects.toThrow(ForbiddenException);
    await expect(edit({ name: 'X' }, { id: 'tl-9', role: UserRole.TEAM_LEAD } as any)).rejects.toThrow(ForbiddenException);
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it('records nothing and uses no transaction for a project that is not completed', async () => {
    prisma.project.findUnique.mockResolvedValue(project());
    prisma.project.update.mockResolvedValue({ id: 'p1' });
    await service.update('p1', { name: 'New' } as any, tester, '1.2.3.4', 'jest');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.projectChange.createMany).not.toHaveBeenCalled();
    expect(prisma.project.update.mock.calls[0][0].data).toEqual({ name: 'New' });
  });

  it('Client SPOC fields save on a normal project and are change-tracked on a completed one', async () => {
    const dto = { clientSpocName: 'Priya', clientSpocDesignation: 'CISO', clientSpocEmail: 'p@acme.com' };

    prisma.project.findUnique.mockResolvedValue(project());
    prisma.project.update.mockResolvedValue({ id: 'p1' });
    await service.update('p1', dto as any, tester, '1.2.3.4', 'jest');
    expect(prisma.project.update.mock.calls[0][0].data).toEqual(dto);
    expect(prisma.projectChange.createMany).not.toHaveBeenCalled();

    prisma.project.update.mockClear();
    prisma.project.findUnique.mockResolvedValue(done({ clientSpocName: 'Priya', clientSpocDesignation: null, clientSpocEmail: null }));
    await service.update('p1', dto as any, tester, '1.2.3.4', 'jest');
    expect(prisma.project.update.mock.calls[0][0].data).toEqual({ clientSpocDesignation: 'CISO', clientSpocEmail: 'p@acme.com' }); // unchanged name not written
    const rows = prisma.projectChange.createMany.mock.calls[0][0].data;
    expect(rows.map((r: any) => [r.field, r.oldValue, r.newValue])).toEqual([
      ['clientSpocDesignation', expect.anything(), 'CISO'],
      ['clientSpocEmail', expect.anything(), 'p@acme.com'],
    ]);
  });

  it('shows change history to leads/admins only', async () => {
    prisma.project.findUnique.mockResolvedValue({ ...done(), tester: { assignedTlId: 'tl-1' }, tl: {}, findings: [] });
    const asLead: any = await service.findOne('p1', { id: 'tl-1', role: UserRole.TEAM_LEAD } as any);
    expect(asLead.changes).toEqual([]);
    expect(prisma.projectChange.findMany).toHaveBeenCalledTimes(1);
    const asTester: any = await service.findOne('p1', tester);
    expect(asTester).not.toHaveProperty('changes');
    expect(prisma.projectChange.findMany).toHaveBeenCalledTimes(1);
  });
});
