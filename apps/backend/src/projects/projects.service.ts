import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { User, UserRole, ProjectStatus } from '@prisma/client';
import { CreateProjectDto, UpdateProjectDto, ReassignProjectDto, ReviewProjectDto } from './dto/project.dto';

@Injectable()
export class ProjectsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private settingsService: SettingsService,
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

  async findAll(user: User) {
    const where: any = {};

    if (user.role === UserRole.TESTER) {
      where.testerId = user.id;
    } else if (user.role === UserRole.TEAM_LEAD || user.role === UserRole.AVP) {
      where.OR = [
        { tlId: user.id },
        { tester: { assignedTlId: user.id } },
      ];
    }

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
    return this.prisma.project.findUnique({
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

    const { settings } = await this.settingsService.get();
    const creationStatus = settings.workflow.defaults.creationStatus as ProjectStatus;

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
        status: creationStatus,
        appVersion: dto.appVersion,
        location: dto.location,
        documentVersion: dto.documentVersion,
        toolsUsed: dto.toolsUsed,
        testingEnvironment: dto.testingEnvironment,
        qaReviewerName: dto.qaReviewerName,
        applicationDetails: dto.applicationDetails,
        testingType: dto.testingType,
        loginSystemTypes: dto.loginSystemTypes,
        applicationNature: dto.applicationNature,
        testingLimitation: dto.testingLimitation,
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

  /** Auto-update project status based on events */
  async autoUpdateStatus(projectId: string, event: 'FINDING_ADDED' | 'REPORT_GENERATED') {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return;

    const { settings } = await this.settingsService.get();
    const { creationStatus, workingStatus, completionStatus } = settings.workflow.defaults;

    let newStatus = project.status;

    if (event === 'FINDING_ADDED' && project.status === creationStatus) {
      newStatus = workingStatus as ProjectStatus;
    } else if (event === 'REPORT_GENERATED' && project.status !== completionStatus) {
      newStatus = completionStatus as ProjectStatus;
    }

    if (newStatus !== project.status) {
      await this.prisma.project.update({
        where: { id: projectId },
        data: { status: newStatus },
      });
    }
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

  async review(id: string, dto: ReviewProjectDto, tlId: string, ipAddress: string, userAgent: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    if (project.tlId !== tlId) {
      throw new ForbiddenException('Only assigned TL can review this project');
    }

    const updateData: any = { status: dto.status };
    if (dto.status === ProjectStatus.COMPLETED) {
      updateData.approvedAt = new Date();
      updateData.approvedById = tlId;
      updateData.isDraft = false;
    }

    await this.prisma.project.update({
      where: { id },
      data: updateData,
    });

    const action = dto.status === ProjectStatus.COMPLETED ? 'PROJECT_APPROVED' : 'PROJECT_REJECTED';
    await this.auditService.log({
      actorId: tlId,
      action,
      targetType: 'PROJECT',
      targetId: id,
      ipAddress,
      userAgent,
      details: { comment: dto.comment },
    });

    return { message: `Project ${dto.status.toLowerCase().replace('_', ' ')}` };
  }
}
