import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ReportsService } from './reports.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from './storage.service';
import { DocxManipulatorService } from './docx-manipulator.service';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';

function actor(role: UserRole, id: string) {
  return { id, role } as any;
}

describe('ReportsService.removeReport', () => {
  let service: ReportsService;
  let prisma: { reportGeneration: { findUnique: jest.Mock; delete: jest.Mock } };
  let storage: { deleteFile: jest.Mock };
  let audit: { log: jest.Mock };

  beforeEach(async () => {
    prisma = {
      reportGeneration: { findUnique: jest.fn(), delete: jest.fn() },
    };
    storage = { deleteFile: jest.fn() };
    audit = { log: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: DocxManipulatorService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    service = moduleRef.get(ReportsService);
  });

  it('throws NotFoundException when the report does not exist', async () => {
    prisma.reportGeneration.findUnique.mockResolvedValue(null);

    await expect(
      service.removeReport('r1', actor(UserRole.ADMIN, 'admin1'), '1.2.3.4', 'jest'),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects deletion by a TL who is not the project tester', async () => {
    prisma.reportGeneration.findUnique.mockResolvedValue({
      id: 'r1',
      projectId: 'p1',
      docxPath: 'x.docx',
      pdfPath: null,
      project: { testerId: 'tester-1' },
    });

    await expect(
      service.removeReport('r1', actor(UserRole.TEAM_LEAD, 'tl-1'), '1.2.3.4', 'jest'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows the assigned tester to delete and removes the stored file', async () => {
    prisma.reportGeneration.findUnique.mockResolvedValue({
      id: 'r1',
      projectId: 'p1',
      docxPath: 'x.docx',
      pdfPath: null,
      project: { testerId: 'tester-1' },
    });
    prisma.reportGeneration.delete.mockResolvedValue({});

    await service.removeReport('r1', actor(UserRole.TESTER, 'tester-1'), '1.2.3.4', 'jest');

    expect(storage.deleteFile).toHaveBeenCalledWith('x.docx');
    expect(prisma.reportGeneration.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'REPORT_DELETED' }));
  });

  it('allows an Admin to delete regardless of project ownership', async () => {
    prisma.reportGeneration.findUnique.mockResolvedValue({
      id: 'r1',
      projectId: 'p1',
      docxPath: null,
      pdfPath: null,
      project: { testerId: 'tester-1' },
    });
    prisma.reportGeneration.delete.mockResolvedValue({});

    await expect(
      service.removeReport('r1', actor(UserRole.ADMIN, 'admin1'), '1.2.3.4', 'jest'),
    ).resolves.toBeUndefined();
  });
});

describe('ReportsService.getNextReportVersion', () => {
  let service: ReportsService;
  let prisma: { reportGeneration: { count: jest.Mock } };

  beforeEach(async () => {
    prisma = { reportGeneration: { count: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: {} },
        { provide: DocxManipulatorService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: AuditService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(ReportsService);
  });

  it('returns 1.0 for the first generation of a project', async () => {
    prisma.reportGeneration.count.mockResolvedValue(0);

    const version = await (service as any).getNextReportVersion('p1');

    expect(version).toBe('1.0');
  });

  it('increments the minor version for each subsequent generation, never resetting', async () => {
    prisma.reportGeneration.count.mockResolvedValue(3);

    const version = await (service as any).getNextReportVersion('p1');

    expect(version).toBe('1.3');
  });
});
