import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { ReportsService } from '../reports/reports.service';
import { StorageService } from '../reports/storage.service';
import { DocxManipulatorService } from '../reports/docx-manipulator.service';
import { XlsxTemplateService } from '../reports/xlsx-template.service';
import { REPORT_GENERATION_QUEUE } from '../reports/report-generation.types';
import { DashboardService } from '../dashboard/dashboard.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';

// Security regression: Team Leads / AVPs must not reach other teams' projects through report endpoints
// or the audit activity feed by supplying IDs (BOLA/IDOR).
const otherTeamProject = { id: 'p1', testerId: 't9', tlId: 'tl-other', tester: { assignedTlId: 'tl-other' } };
const tl = { id: 'tl1', role: UserRole.TEAM_LEAD } as any;
const avp = { id: 'avp1', role: UserRole.AVP } as any;
const admin = { id: 'a1', role: UserRole.ADMIN } as any;

describe('report endpoints enforce team scope', () => {
  let svc: ReportsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      project: { findUnique: jest.fn().mockResolvedValue(otherTeamProject) },
      reportGeneration: { findUnique: jest.fn().mockResolvedValue({ id: 'r1', status: 'COMPLETED', project: otherTeamProject }), findMany: jest.fn().mockResolvedValue([]) },
    };
    const ref = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: { getPresignedUrl: jest.fn() } },
        { provide: DocxManipulatorService, useValue: {} },
        { provide: XlsxTemplateService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: SettingsService, useValue: {} },
        { provide: getQueueToken(REPORT_GENERATION_QUEUE), useValue: { add: jest.fn() } },
      ],
    }).compile();
    svc = ref.get(ReportsService);
  });

  it.each([tl, avp])('%p cannot read status/history/preflight/issue-log/generate for another team', async (u) => {
    await expect(svc.getReportGenerationStatus('r1', u)).rejects.toThrow(NotFoundException);
    await expect(svc.getReportHistory('p1', u)).rejects.toThrow(NotFoundException);
    await expect(svc.preflight('p1', u)).rejects.toThrow(NotFoundException);
    await expect(svc.generateIssueLog('p1', u)).rejects.toThrow(NotFoundException);
    await expect(svc.generateReport('p1', u, 'ip', 'ua')).rejects.toThrow(NotFoundException);
  });

  it('admin is not blocked by the scope check', async () => {
    await expect(svc.getReportHistory('p1', admin)).resolves.toEqual([]);
  });
});

describe('DashboardService.getRecentActivity scoping', () => {
  it('limits a Team Lead to own team actors; Admin/AVP unrestricted', async () => {
    const prisma: any = {
      user: { findMany: jest.fn().mockResolvedValue([{ id: 't1' }]) },
      auditLog: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const ref = await Test.createTestingModule({
      providers: [DashboardService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    const svc = ref.get(DashboardService);

    await svc.getRecentActivity(10, tl);
    expect(prisma.auditLog.findMany.mock.calls[0][0].where).toEqual({ actorId: { in: ['tl1', 't1'] } });

    await svc.getRecentActivity(10, admin);
    expect(prisma.auditLog.findMany.mock.calls[1][0].where).toEqual({});
  });
});

describe('GET /dashboard/activity (the activity log)', () => {
  it('is Admin only', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DashboardController } = require('../dashboard/dashboard.controller');
    const key = Reflect.getMetadata('permission', DashboardController.prototype.getRecentActivity);
    expect(key).toBe('dashboard.activity_log');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { permissionRules } = require('./permissions');
    expect(['ADMIN', 'AVP', 'TEAM_LEAD', 'TESTER'].filter((r) => permissionRules.can(r, key))).toEqual(['ADMIN']);
  });

  it('returns the actor\'s name and role with each entry', async () => {
    const prisma: any = { auditLog: { findMany: jest.fn().mockResolvedValue([]) } };
    const ref = await Test.createTestingModule({ providers: [DashboardService, { provide: PrismaService, useValue: prisma }] }).compile();
    await ref.get(DashboardService).getRecentActivity(10, admin);
    expect(prisma.auditLog.findMany.mock.calls[0][0].include.actor.select).toEqual({ id: true, username: true, fullName: true, role: true });
  });
});
