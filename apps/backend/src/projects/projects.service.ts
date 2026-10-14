import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { VULN_INCLUDE, withVulnerability, bySeverityScore } from '../common/finding-vulnerability.util';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ProjectPurgeService } from '../common/project-purge.service';
import { Prisma, User, UserRole, ProjectStatus, NotificationType, ReportFormat } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateProjectDto, UpdateProjectDto, ReassignProjectDto } from './dto/project.dto';
import { findingPocReadiness } from '../common/poc-validation.util';
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

/** Null-ish ('' / undefined) and Date-vs-ISO differences are not real changes; compare JSON with sorted keys. */
function normalizeForCompare(v: unknown): unknown {
  if (v === undefined || v === null || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(normalizeForCompare);
  if (typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, normalizeForCompare(x)]),
    );
  }
  return v;
}
const sameValue = (a: unknown, b: unknown) => JSON.stringify(normalizeForCompare(a)) === JSON.stringify(normalizeForCompare(b));

type FieldChange = { field: string; oldValue: unknown; newValue: unknown };

const DETAIL_FIELDS = [
  'appVersion', 'location', 'documentVersion', 'toolsUsed', 'testingEnvironment',
  'qaReviewerName', 'applicationDetails', 'testingType', 'loginSystemTypes',
  'applicationNature', 'testingLimitation', 'complianceType',
  'mobilePlatform', 'sha1', 'externalInternal', 'networkActivityType', 'totalScopeCount', 'networkScope', 'quarter',
  'toolsUsedTable',
] as const;

@Injectable()
export class ProjectsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private projectPurge: ProjectPurgeService,
    private notifications: NotificationsService,
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
            ...VULN_INCLUDE,
            pocSteps: {
              orderBy: { stepNo: 'asc' },
            },
          },
        },
      },
    });
    if (!result) return result;
    // Post-completion change history is for Team Leads / Admins only (access to the project is already checked).
    const changes = user.role === UserRole.TESTER ? [] : await this.prisma.projectChange.findMany({
      where: { projectId: id },
      orderBy: { changedAt: 'asc' },
      select: { id: true, field: true, oldValue: true, newValue: true, changedByName: true, changedAt: true },
    });
    return {
      ...result,
      ...(user.role !== UserRole.TESTER && { changes }),
      findings: result.findings
        .map(withVulnerability)
        .sort(bySeverityScore)
        .map((f) => { const pocReadiness = findingPocReadiness(f, result.subType); return { ...f, pocComplete: pocReadiness === 'ready', pocReadiness }; }),
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
          reportFormat: ReportFormat.WORD,
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
        networkActivityType: dto.networkActivityType,
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

    if (dto.startDate !== undefined && user.id !== existingProject.testerId) {
      throw new ForbiddenException('Only the assigned tester can edit the start date');
    }

    const project = existingProject.status === ProjectStatus.COMPLETED
      ? await this.updateCompleted(id, dto, user)
      : await this.prisma.project.update({ where: { id }, data: this.buildUpdateData(dto, existingProject) });

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

  private buildUpdateData(dto: UpdateProjectDto, existingProject: { startDate: Date }) {
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
    for (const field of DETAIL_FIELDS) {
      if (dto[field] !== undefined) {
        updateData[field] = dto[field];
      }
    }
    if (dto.toolsUsedTable !== undefined) {
      updateData.toolsUsed = deriveToolsUsedSummary(dto.toolsUsedTable);
    }
    return updateData;
  }

  /**
   * Edit of a COMPLETED project. Status, completion date (generatedAt), reports and files are
   * never in the update data. Inside one transaction (row locked, so concurrent edits serialize
   * and each diff is against the truly stored values) only genuinely changed fields are written,
   * and one append-only ProjectChange row per changed field records old/new and who made it.
   */
  private async updateCompleted(id: string, dto: UpdateProjectDto, user: User) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM projects WHERE id = ${id} FOR UPDATE`;
      const current = await tx.project.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Project not found');

      const data = this.buildUpdateData(dto, current);
      const changes: FieldChange[] = [];
      for (const field of Object.keys(data)) {
        if (field === 'startDateChangedAt') continue;
        const oldValue = (current as any)[field];
        if (field === 'customFieldValues') {
          const before = (oldValue ?? {}) as Record<string, unknown>;
          const after = (data[field] ?? {}) as Record<string, unknown>;
          const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
          const diffs = [...keys].filter((k) => !sameValue(before[k], after[k]));
          for (const k of diffs) changes.push({ field: `customFieldValues.${k}`, oldValue: before[k], newValue: after[k] });
          if (!diffs.length) delete data[field];
        } else if (sameValue(oldValue, data[field])) {
          delete data[field];
        } else if (field !== 'toolsUsed') {
          // toolsUsed is derived from toolsUsedTable; the table is the recorded change.
          changes.push({ field, oldValue, newValue: data[field] });
        }
      }
      if (!('startDate' in data)) delete data.startDateChangedAt;
      if (!Object.keys(data).length) return current;

      const project = await tx.project.update({ where: { id }, data });
      await tx.projectChange.createMany({
        data: changes.map((c) => ({
          projectId: id,
          projectName: project.name,
          field: c.field,
          oldValue: (normalizeForCompare(c.oldValue) ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          newValue: (normalizeForCompare(c.newValue) ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          changedById: user.id,
          changedByName: user.fullName || user.username,
        })),
      });
      return project;
    });
  }

  /**
   * Admin: any project to any active tester. TL/AVP: only projects they can open, and only to
   * testers on their own team. Findings, reports and access all key off project.testerId, so
   * moving it moves them together; nothing is copied or deleted. tlId follows the new tester's
   * team so TL access and the dashboards stay consistent.
   */
  async reassign(id: string, dto: ReassignProjectDto, actor: User, ipAddress: string, userAgent: string) {
    const project = await this.prisma.project.findUnique({ where: { id }, include: { tester: true } });
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const isAdmin = actor.role === UserRole.ADMIN;
    if (!isAdmin && project.tlId !== actor.id && project.tester.assignedTlId !== actor.id) {
      throw new ForbiddenException('You can only reassign projects from your own team');
    }

    const newTester = await this.prisma.user.findUnique({ where: { id: dto.testerId } });
    if (
      !newTester ||
      newTester.role !== UserRole.TESTER ||
      !newTester.isActive ||
      newTester.deletedAt ||
      (!isAdmin && newTester.assignedTlId !== actor.id)
    ) {
      throw new BadRequestException('Invalid tester assignment');
    }
    if (newTester.id === project.testerId) {
      throw new BadRequestException('Project is already assigned to this tester');
    }

    const updated = await this.prisma.project.update({
      where: { id },
      data: { testerId: newTester.id, tlId: newTester.assignedTlId ?? project.tlId },
      include: {
        tester: { select: { id: true, username: true, email: true, fullName: true } },
        tl: { select: { id: true, username: true, email: true, fullName: true } },
      },
    });

    await this.auditService.log({
      actorId: actor.id,
      action: 'PROJECT_REASSIGNED',
      targetType: 'PROJECT',
      targetId: id,
      ipAddress,
      userAgent,
      details: { previousTesterId: project.testerId, newTesterId: newTester.id },
    });

    // The assignment is already committed; a failed notification must not undo or fail it.
    try {
      await this.notifications.create({
        userId: newTester.id,
        type: NotificationType.PROJECT_ASSIGNED,
        title: 'Project assigned to you',
        message: `You have been assigned the project "${project.name}" (${project.clientName}).`,
        linkUrl: `/dashboard/projects/${id}`,
        relatedId: id,
      });
    } catch {
      // ponytail: best-effort, no retry queue; add one if missed notifications matter.
    }

    return { message: 'Project reassigned successfully', tester: updated.tester, tl: updated.tl };
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
