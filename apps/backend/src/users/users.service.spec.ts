import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { ProjectPurgeService } from '../common/project-purge.service';

describe('UsersService.softDelete', () => {
  let service: UsersService;
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock };
    project: { findMany: jest.Mock };
  };
  let audit: { log: jest.Mock };
  let projectPurge: { purgeProject: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn() },
      project: { findMany: jest.fn().mockResolvedValue([]) },
    };
    audit = { log: jest.fn() };
    projectPurge = { purgeProject: jest.fn().mockResolvedValue({ filesDeleted: 2 }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: NotificationsService, useValue: {} },
        { provide: SettingsService, useValue: {} },
        { provide: ProjectPurgeService, useValue: projectPurge },
      ],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  it('throws NotFoundException when the user does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.softDelete('u1', 'admin1', '1.2.3.4', 'jest')).rejects.toThrow(NotFoundException);
  });

  it('deactivates the user without purging anything when they own no projects', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    prisma.project.findMany.mockResolvedValue([]);

    const result = await service.softDelete('u1', 'admin1', '1.2.3.4', 'jest');

    expect(projectPurge.purgeProject).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { isActive: false } });
    expect(result.projectsDeleted).toBe(0);
  });

  it('purges every project owned (as tester) by the deleted user, and logs the totals', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    prisma.project.findMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);

    const result = await service.softDelete('u1', 'admin1', '1.2.3.4', 'jest');

    expect(prisma.project.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { testerId: 'u1' } }));
    expect(projectPurge.purgeProject).toHaveBeenCalledTimes(2);
    expect(result.projectsDeleted).toBe(2);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'USER_DELETED', details: { projectsDeleted: 2, filesDeleted: 4 } }),
    );
  });
});
