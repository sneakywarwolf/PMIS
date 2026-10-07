import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ProjectPurgeService } from '../common/project-purge.service';
import { User, UserRole, ProjectStatus } from '@prisma/client';
import { CreateProjectDto, UpdateProjectDto, ReassignProjectDto } from './dto/project.dto';
import { getPocReadiness, isFindingReportReady } from '../common/poc-validation.util';
import { parseNmapScan, NmapPortRecord } from '../common/nmap-parser.util';

/**
 * Derives the legacy single-line {Tools Used} value from the structured
 * table rows, so existing templates using that one placeholder keep
 * working without any template changes.
 */
function deriveToolsUsedSummary(rows?: { name: string; version: string; licenseType: string }[]): string {
  if (!rows || rows.length === 0) return '';
  return rows
    .map((r) => [r.name, r.version].filter(Boolean).join(' ') + (r.licenseType ? ` (${r.licenseType})` : ''))
    .filter(Boolean)
    .join(', ');
}

@Injectable()
export class ProjectsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private projectPurge: ProjectPurgeService,
  ) {}

  private async checkProjectAccess(projectId: string, user: User) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { tester: true, tl: true },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    if (user.role === UserRole.ADMIN) return project;

    if (user.role === UserRole.TEAM_LEAD || user.role === UserRole.AVP) {
      if (project.tlId === user.id || project.tester.assignedTlId === user.id) {
        return project;
      }
    }

    if (user.role === UserRole.TESTER && project.testerId === user.id) {
      return project;
    }

    throw new ForbiddenException('Access denied to this project');
  }

  /** Which projects a user may open — mirrors checkProjectAccess, and is shared by the list and Ctrl+K search. */
  private accessWhere(user: User): any {
    if (user.role === UserRole.TESTER) return { testerId: user.id };
    if (user.role === UserRole.TEAM_LEAD || user.role === UserRole.AVP) {
      return { OR: [{ tlId: user.id }, { tester: { assignedTlId: user.id } }] };
    }
    return {};
  }

  /** Minimal project rows for the Ctrl+K palette: only projects the caller can open, and only the fields it displays. */
  async searchProjects(user: User) {
    return this.prisma.project.findMany({
      where: this.accessWhere(user),
      select: { id: true, name: true, clientName: true, scope: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async findAll(user: User) {
    const where = this.accessWhere(user);

    return this.prisma.project.findMany({
      where,
      include: {
        tester: {
          select: { id: true, username: true, email: true, fullName: true },
        },
        tl: {
          select: { id: true, username: true, email: true, fullName: true },
        },
        template: {
          select: { id: true, name: true, projectType: true },
        },
        _count: {
          select: { findings: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, user: User) {
    const project = await this.checkProjectAccess(id, user);
    const result = await this.prisma.project.findUnique({
      where: { id },
      include: {
        tester: {
          select: { id: true, username: true, email: true, fullName: true },
        },
        tl: {
          select: { id: true, username: true, email: true, fullName: true },
        },
        template: true,
        findings: {
          include: {
            vulnerability: true,
            pocSteps: {
              orderBy: { stepNo: 'asc' },
            },
          },
          orderBy: [
            { cvssScoreOverride: { sort: 'desc', nulls: 'last' } },
            { vulnerability: { cvssScore: 'desc' } },
          ],
        },
      },
    });
    if (!result) return result;
    return {
      ...result,
      findings: result.findings.map((f) => ({ ...f, pocComplete: isFindingReportReady(f.pocSteps), pocReadiness: getPocReadiness(f.pocSteps) })),
    };
  }

  async create(dto: CreateProjectDto, testerId: string, tlId: string, ipAddress: string, userAgent: string) {
    let templateId = dto.templateId;
    if (!templateId) {
      const defaultTemplate = await this.prisma.reportTemplate.findFirst({
        where: {
          isActive: true,
          category: dto.category,
          subType: dto.subType,
        },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (defaultTemplate) {
        templateId = defaultTemplate.id;
      }
    }

    const project = await this.prisma.project.create({
      data: {
        name: dto.name,
        clientName: dto.clientName,
        scope: dto.scope,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        testerId,
        tlId,
        templateId,
        complianceType: dto.complianceType,
        category: dto.category,
        subType: dto.subType,
        status: ProjectStatus.NOT_STARTED,
        appVersion: dto.appVersion,
        location: dto.location,
        documentVersion: dto.documentVersion,
        toolsUsed: dto.toolsUsedTable ? deriveToolsUsedSummary(dto.toolsUsedTable) : dto.toolsUsed,
        toolsUsedTable: dto.toolsUsedTable as any,
        testingEnvironment: dto.testingEnvironment,
        qaReviewerName: dto.qaReviewerName,
        applicationDetails: dto.applicationDetails,
        testingType: dto.testingType,
        loginSystemTypes: dto.loginSystemTypes,
        applicationNature: dto.applicationNature,
        testingLimitation: dto.testingLimitation,
        mobilePlatform: dto.mobilePlatform,
        sha1: dto.sha1,
        externalInternal: dto.externalInternal,
        totalScopeCount: dto.totalScopeCount,
        networkScope: dto.networkScope as any,
        quarter: dto.quarter,
        customFieldValues: dto.customFieldValues,
      },
      include: {
        tester: { select: { id: true, username: true } },
        tl: { select: { id: true, username: true } },
      },
    });

    await this.auditService.log({
      actorId: testerId,
      action: 'PROJECT_CREATED',
      targetType: 'PROJECT',
      targetId: project.id,
      ipAddress,
      userAgent,
      details: { name: project.name, client: project.clientName },
    });

    return project;
  }

  async update(id: string, dto: UpdateProjectDto, user: User, ipAddress: string, userAgent: string) {
    const existingProject = await this.checkProjectAccess(id, user);

    if (user.role === UserRole.TESTER && existingProject.status === ProjectStatus.COMPLETED) {
      throw new ForbiddenException('Cannot edit completed projects');
    }

    if (dto.startDate !== undefined && user.id !== existingProject.testerId) {
      throw new ForbiddenException('Only the assigned tester can edit the start date');
    }

    const detailFields = [
      'appVersion', 'location', 'documentVersion', 'toolsUsed', 'testingEnvironment',
      'qaReviewerName', 'applicationDetails', 'testingType', 'loginSystemTypes',
      'applicationNature', 'testingLimitation', 'complianceType',
      'mobilePlatform', 'sha1', 'externalInternal', 'totalScopeCount', 'networkScope', 'quarter',
      'toolsUsedTable',
    ] as const;

    const updateData: any = {
      ...(dto.name && { name: dto.name }),
      ...(dto.clientName && { clientName: dto.clientName }),
      ...(dto.scope && { scope: dto.scope }),
      ...(dto.startDate && { startDate: new Date(dto.startDate) }),
      ...(dto.startDate && new Date(dto.startDate).getTime() !== existingProject.startDate.getTime() && {
        startDateChangedAt: new Date(),
      }),
      ...(dto.endDate !== undefined && { endDate: dto.endDate ? new Date(dto.endDate) : null }),
      ...(dto.templateId !== undefined && { templateId: dto.templateId || null }),
      ...(dto.complianceStatus !== undefined && { complianceStatus: dto.complianceStatus }),
      ...(dto.customFieldValues !== undefined && { customFieldValues: dto.customFieldValues }),
    };
    for (const field of detailFields) {
      if (dto[field] !== undefined) {
        updateData[field] = dto[field];
      }
    }
    if (dto.toolsUsedTable !== undefined) {
      updateData.toolsUsed = deriveToolsUsedSummary(dto.toolsUsedTable);
    }

    const project = await this.prisma.project.update({
      where: { id },
      data: updateData,
    });

    await this.auditService.log({
      actorId: user.id,
      action: 'PROJECT_UPDATED',
      targetType: 'PROJECT',
      targetId: id,
      ipAddress,
      userAgent,
      details: dto,
    });

    return project;
  }

  async reassign(id: string, dto: ReassignProjectDto, tlId: string, ipAddress: string, userAgent: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const newTester = await this.prisma.user.findUnique({
      where: { id: dto.testerId },
    });

    if (!newTester || newTester.role !== UserRole.TESTER || newTester.assignedTlId !== tlId) {
      throw new BadRequestException('Invalid tester assignment');
    }

    await this.prisma.project.update({
      where: { id },
      data: { testerId: dto.testerId },
    });

    await this.auditService.log({
      actorId: tlId,
      action: 'PROJECT_REASSIGNED',
      targetType: 'PROJECT',
      targetId: id,
      ipAddress,
      userAgent,
      details: { newTesterId: dto.testerId },
    });

    return { message: 'Project reassigned successfully' };
  }

  /**
   * Admin-only permanent delete. Removes the project's stored files (report
   * docx/pdf, finding evidence, PoC images) and the DB row; Prisma cascade
   * takes care of Finding/PocStep/ReportGeneration rows so nothing orphans.
   */
  async remove(id: string, adminId: string, ipAddress: string, userAgent: string) {
    const project = await this.projectPurge.loadPurgeableProject(id);
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const { filesDeleted } = await this.projectPurge.purgeProject(project);

    await this.auditService.log({
      actorId: adminId,
      action: 'PROJECT_DELETED',
      targetType: 'PROJECT',
      targetId: id,
      ipAddress,
      userAgent,
      details: { filesDeleted },
    });

    return { message: 'Project permanently deleted', filesDeleted };
  }

  /**
   * Network-only: parses an uploaded Nmap XML scan and appends its
   * IP/port/protocol/service/status rows to the project, so repeated scans
   * accumulate rather than overwrite each other.
   */
  async importNmapScan(id: string, file: Express.Multer.File, user: User) {
    const project = await this.checkProjectAccess(id, user);
    if (project.subType !== 'NETWORK') {
      throw new BadRequestException('Nmap port import is only available for Network projects');
    }
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const records = parseNmapScan(file.buffer.toString('utf-8'));
    if (records.length === 0) {
      throw new BadRequestException('No ports found in the uploaded Nmap scan');
    }

    const existing = ((project as any).nmapPorts as NmapPortRecord[] | null) || [];
    const nmapPorts = [...existing, ...records];

    await this.prisma.project.update({ where: { id }, data: { nmapPorts: nmapPorts as any } });

    return { message: 'Nmap scan imported', recordsImported: records.length, totalRecords: nmapPorts.length };
  }
}
