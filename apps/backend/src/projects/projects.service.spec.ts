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
