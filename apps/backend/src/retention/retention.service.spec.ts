import { Test } from '@nestjs/testing';
import { UserRole, ProjectStatus } from '@prisma/client';
import { RetentionService } from './retention.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../reports/storage.service';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { ProjectPurgeService } from '../common/project-purge.service';

function makeSettings(attachmentRetentionDays: number, projectRetentionDays: number) {
  return { settings: { system: { attachmentRetentionDays, projectRetentionDays } } };
}

describe('RetentionService.runRetentionSweep', () => {
  let service: RetentionService;
  let prisma: {
    user: { findFirst: jest.Mock; findMany: jest.Mock; delete: jest.Mock };
    $transaction: jest.Mock;
    pocStep: { findMany: jest.Mock; update: jest.Mock };
    project: { findMany: jest.Mock; updateMany: jest.Mock };
    [model: string]: any;
  };
  let storage: { deleteFile: jest.Mock };
  let settingsService: { get: jest.Mock };
  let audit: { log: jest.Mock };
  let projectPurge: { purgeProject: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'admin1' }), findMany: jest.fn().mockResolvedValue([]), delete: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([]),
      pocStep: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      project: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
      finding: { updateMany: jest.fn() },
      reportGeneration: { updateMany: jest.fn() },
      reportTemplate: { updateMany: jest.fn() },
      quizQuestion: { updateMany: jest.fn() },
      vulnerabilityChangeRequest: { updateMany: jest.fn() },
      quizAttempt: { deleteMany: jest.fn() },
      quizUserStats: { deleteMany: jest.fn() },
      patternMapScore: { deleteMany: jest.fn() },
      auditLog: { deleteMany: jest.fn() },
    };
    storage = { deleteFile: jest.fn() };
    settingsService = { get: jest.fn().mockResolvedValue(makeSettings(90, 365)) };
    audit = { log: jest.fn() };
    projectPurge = { purgeProject: jest.fn().mockResolvedValue({ filesDeleted: 3 }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RetentionService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: SettingsService, useValue: settingsService },
        { provide: AuditService, useValue: audit },
        { provide: ProjectPurgeService, useValue: projectPurge },
      ],
    }).compile();
    service = moduleRef.get(RetentionService);
  });

  it('deletes expired PoC attachment files and clears imagePath, without deleting the step', async () => {
    prisma.pocStep.findMany.mockResolvedValue([{ id: 'step1', imagePath: 'old.png' }]);

    await service.runRetentionSweep();

    expect(storage.deleteFile).toHaveBeenCalledWith('old.png');
    expect(prisma.pocStep.update).toHaveBeenCalledWith({ where: { id: 'step1' }, data: { imagePath: null, extraImagePaths: [] } });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ATTACHMENT_RETENTION_DELETED' }));
  });

  it('also deletes the further PoCs of a step that has several', async () => {
    prisma.pocStep.findMany.mockResolvedValue([{ id: 'step2', imagePath: 'a.png', extraImagePaths: ['b.png', 'c.png'] }]);

    await service.runRetentionSweep();

    expect(storage.deleteFile).toHaveBeenCalledWith('a.png');
    expect(storage.deleteFile).toHaveBeenCalledWith('b.png');
    expect(storage.deleteFile).toHaveBeenCalledWith('c.png');
    expect(prisma.pocStep.update).toHaveBeenCalledWith({ where: { id: 'step2' }, data: { imagePath: null, extraImagePaths: [] } });
  });

  it('purges an expired completed project and logs the deletion', async () => {
    prisma.project.findMany.mockResolvedValue([
      { id: 'p1', name: 'Old Project', status: ProjectStatus.COMPLETED },
    ]);

    await service.runRetentionSweep();

    expect(projectPurge.purgeProject).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }));
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PROJECT_RETENTION_DELETED', targetId: 'p1', details: { name: 'Old Project', filesDeleted: 3 } }),
    );
  });

  it('purges owned projects for a user whose 24h deletion grace period has expired', async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', username: 'deleted.user', projectsOwned: [{ id: 'p1' }] },
    ]);

    await service.runRetentionSweep();

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: false, deletedAt: { lt: expect.any(Date) } } }),
    );
    expect(projectPurge.purgeProject).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }));
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'u1' } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'USER_RETENTION_PURGED',
        targetId: 'u1',
        details: { username: 'deleted.user', projectsDeleted: 1, filesDeleted: 3 },
      }),
    );
  });

  it('skips audit logging when no admin user exists yet', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.pocStep.findMany.mockResolvedValue([{ id: 'step1', imagePath: 'old.png' }]);

    await service.runRetentionSweep();

    expect(storage.deleteFile).toHaveBeenCalledWith('old.png');
    expect(audit.log).not.toHaveBeenCalled();
  });
});
