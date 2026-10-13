import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { RedisService } from '../redis/redis.service';

describe('UsersService.softDelete', () => {
  let service: UsersService;
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock };
  };
  let audit: { log: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn() },
    };
    audit = { log: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: NotificationsService, useValue: {} },
        { provide: SettingsService, useValue: {} },
        { provide: RedisService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  it('throws NotFoundException when the user does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.softDelete('u1', 'admin1', '1.2.3.4', 'jest')).rejects.toThrow(NotFoundException);
  });

  it('deactivates the user and starts the 24h grace period without purging any data', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });

    const result = await service.softDelete('u1', 'admin1', '1.2.3.4', 'jest');

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { isActive: false, deletedAt: expect.any(Date) },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'USER_DELETED', targetId: 'u1', details: { gracePeriodHours: 24 } }),
    );
    expect(result.message).toMatch(/24 hours/);
  });
});

describe('UsersService.bulkUpload', () => {
  let service: UsersService;
  let prisma: {
    user: { findMany: jest.Mock; create: jest.Mock };
  };
  let audit: { log: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({}) },
    };
    audit = { log: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: NotificationsService, useValue: {} },
        { provide: SettingsService, useValue: { get: jest.fn().mockResolvedValue({ settings: { security: { passwordMinLength: 12, passwordRequireComplexity: true } } }) } },
        { provide: RedisService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  it('rejects a CSV with a missing/renamed required header, and never creates a user', async () => {
    const badCsv = [
      'S.No,Full Name,Email Address,Mobile,Designation,Role,Team Lead,Manager',
      '1,Jane Doe,jane@example.com,555-1234,QA,Tester,,',
    ].join('\n');

    await expect(service.bulkUpload(badCsv, 'admin1', '1.2.3.4', 'jest')).rejects.toThrow(
      'Missing or incorrect header(s): Email',
    );
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('accepts headers in a different order, since rows are extracted by header name', async () => {
    const reorderedCsv = [
      'Email,S.No,Role,Full Name,Mobile,Designation,Team Lead,Manager',
      'jane@example.com,1,Tester,Jane Doe,555-1234,QA,,',
    ].join('\n');

    const results = await service.bulkUpload(reorderedCsv, 'admin1', '1.2.3.4', 'jest');

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: 'jane@example.com', fullName: 'Jane Doe' }) }),
    );
    expect(results.added).toBe(1);
    expect(results.credentials).toEqual([expect.objectContaining({ email: 'jane@example.com', tempPassword: expect.stringMatching(/^.{12,}$/) })]);
  });
});
