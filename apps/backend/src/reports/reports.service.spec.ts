import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { UserRole } from '@prisma/client';
import { ReportsService } from './reports.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from './storage.service';
import { DocxManipulatorService } from './docx-manipulator.service';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { REPORT_GENERATION_QUEUE } from './report-generation.types';

function actor(role: UserRole, id: string) {
  return { id, role } as any;
}

function makeQueueMock() {
  return { add: jest.fn() };
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
        { provide: SettingsService, useValue: {} },
        { provide: getQueueToken(REPORT_GENERATION_QUEUE), useValue: makeQueueMock() },
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
  let prisma: { project: { findUnique: jest.Mock } };

  beforeEach(async () => {
    prisma = { project: { findUnique: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: {} },
        { provide: DocxManipulatorService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: AuditService, useValue: {} },
        { provide: SettingsService, useValue: {} },
        { provide: getQueueToken(REPORT_GENERATION_QUEUE), useValue: makeQueueMock() },
      ],
    }).compile();
    service = moduleRef.get(ReportsService);
  });

  it('returns 1.0 for the first generation of a project', async () => {
    prisma.project.findUnique.mockResolvedValue({ reportVersionCounter: 0 });

    const version = await (service as any).getNextReportVersion('p1');

    expect(version).toBe('1.0');
  });

  it('is based on the persisted counter, not a count of ReportGeneration rows', async () => {
    prisma.project.findUnique.mockResolvedValue({ reportVersionCounter: 3 });

    const version = await (service as any).getNextReportVersion('p1');

    expect(version).toBe('1.3');
    expect(prisma.project.findUnique).toHaveBeenCalledWith({ where: { id: 'p1' }, select: { reportVersionCounter: true } });
  });
});

describe('ReportsService.generateReport (fast/enqueue path)', () => {
  let service: ReportsService;
  let prisma: {
    project: { findUnique: jest.Mock };
    reportTemplate: { findFirst: jest.Mock };
    reportGeneration: { count: jest.Mock; create: jest.Mock };
  };
  let storage: { getFile: jest.Mock; uploadFile: jest.Mock };
  let docxManipulator: { generateReport: jest.Mock };
  let queue: { add: jest.Mock };

  const approvedFinding = {
    id: 'f1',
    proofOfConcept: 'poc text',
    pocSteps: [{ stepNo: 1, description: 'step', imagePath: 'evidence/step1.png' }],
    vulnerability: { name: 'X', severity: 'High', cvssScore: 7.5 },
    affectedInstances: [],
  };

  beforeEach(async () => {
    prisma = {
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'p1',
          category: 'VAPT',
          subType: 'WEB',
          template: { id: 't1', filePath: 'templates/t1.docx', subType: 'WEB' },
          tester: {},
          tl: { manager: null },
          findings: [approvedFinding],
        }),
      },
      reportTemplate: { findFirst: jest.fn() },
      reportGeneration: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'rg1' }),
      },
    };
    storage = { getFile: jest.fn(), uploadFile: jest.fn() };
    docxManipulator = { generateReport: jest.fn() };
    queue = makeQueueMock();

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: DocxManipulatorService, useValue: docxManipulator },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: AuditService, useValue: { log: jest.fn() } },
        // generateReport reads the configured report-date format (formatting.reportDateFormat); empty settings use the default.
        { provide: SettingsService, useValue: { get: jest.fn().mockResolvedValue({ settings: {} }) } },
        { provide: getQueueToken(REPORT_GENERATION_QUEUE), useValue: queue },
      ],
    }).compile();
    service = moduleRef.get(ReportsService);
  });

  it('rejects a second submission while one is already in flight (no row, no job)', async () => {
    prisma.reportGeneration.count.mockResolvedValue(1);
    await expect(service.generateReport('p1', actor(UserRole.ADMIN, 'admin1'), '1.2.3.4', 'jest')).rejects.toThrow(/already being generated/);
    expect(prisma.reportGeneration.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('creates a PENDING report row and enqueues a job, without touching docx generation or storage', async () => {
    const result = await service.generateReport('p1', actor(UserRole.ADMIN, 'admin1'), '1.2.3.4', 'jest');

    expect(prisma.reportGeneration.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING', version: '1.0' }) }),
    );
    expect(queue.add).toHaveBeenCalledWith('generate', expect.objectContaining({ reportGenerationId: 'rg1', actorId: 'admin1' }));
    expect(docxManipulator.generateReport).not.toHaveBeenCalled();
    expect(storage.uploadFile).not.toHaveBeenCalled();
    expect(result).toEqual({ reportId: 'rg1', status: 'PENDING', version: '1.0' });
  });

  it('rejects before enqueuing when a finding is missing Steps or PoC', async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: 'p1',
      category: 'VAPT',
      subType: 'WEB',
      template: { id: 't1', filePath: 'templates/t1.docx', subType: 'WEB' },
      tester: {},
      tl: { manager: null },
      findings: [{ ...approvedFinding, pocSteps: [{ stepNo: 1, description: 'step', imagePath: null }] }],
    });

    await expect(
      service.generateReport('p1', actor(UserRole.ADMIN, 'admin1'), '1.2.3.4', 'jest'),
    ).rejects.toThrow('Report Generation not allowed until Steps and PoC screenshots/attachments are added.');
    expect(queue.add).not.toHaveBeenCalled();
    expect(prisma.reportGeneration.create).not.toHaveBeenCalled();
  });
});

describe('ReportsService.getReportGenerationStatus', () => {
  let service: ReportsService;
  let prisma: { reportGeneration: { findUnique: jest.Mock } };
  let storage: { getPresignedUrl: jest.Mock };

  beforeEach(async () => {
    prisma = { reportGeneration: { findUnique: jest.fn() } };
    storage = { getPresignedUrl: jest.fn().mockResolvedValue('https://example.com/signed') };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: DocxManipulatorService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: AuditService, useValue: {} },
        { provide: SettingsService, useValue: {} },
        { provide: getQueueToken(REPORT_GENERATION_QUEUE), useValue: makeQueueMock() },
      ],
    }).compile();
    service = moduleRef.get(ReportsService);
  });

  it('throws NotFoundException when the report does not exist', async () => {
    prisma.reportGeneration.findUnique.mockResolvedValue(null);

    await expect(
      service.getReportGenerationStatus('r1', actor(UserRole.ADMIN, 'admin1')),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a Tester polling a report that belongs to a project they are not assigned to (IDOR guard)', async () => {
    prisma.reportGeneration.findUnique.mockResolvedValue({
      id: 'r1',
      status: 'COMPLETED',
      docxPath: 'reports/p1/1_report.docx',
      project: { testerId: 'someone-else' },
    });

    await expect(
      service.getReportGenerationStatus('r1', actor(UserRole.TESTER, 'tester-1')),
    ).rejects.toThrow(NotFoundException);
    expect(storage.getPresignedUrl).not.toHaveBeenCalled();
  });

  it('allows the assigned tester to poll their own project\'s report', async () => {
    prisma.reportGeneration.findUnique.mockResolvedValue({
      id: 'r1',
      status: 'COMPLETED',
      version: '1.0',
      error: null,
      docxPath: 'reports/p1/1_report.docx',
      project: { testerId: 'tester-1' },
    });

    const result = await service.getReportGenerationStatus('r1', actor(UserRole.TESTER, 'tester-1'));

    expect(result.status).toBe('COMPLETED');
    expect(result.docxUrl).toBe('https://example.com/signed');
  });

  it('allows an Admin to poll any project\'s report', async () => {
    prisma.reportGeneration.findUnique.mockResolvedValue({
      id: 'r1',
      status: 'PENDING',
      version: '1.0',
      error: null,
      docxPath: null,
      project: { testerId: 'someone-else' },
    });

    const result = await service.getReportGenerationStatus('r1', actor(UserRole.ADMIN, 'admin1'));

    expect(result.status).toBe('PENDING');
    expect(result.docxUrl).toBeNull();
  });
});
