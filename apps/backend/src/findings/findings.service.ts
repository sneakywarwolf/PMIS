import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { User, UserRole, FindingStatus, ProjectStatus } from '@prisma/client';

@Injectable()
export class FindingsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
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
    if (user.role === UserRole.TEAM_LEAD) {
      if (project.tlId === user.id || project.tester.assignedTlId === user.id) {
        return project;
      }
    }
    if (user.role === UserRole.TESTER && project.testerId === user.id) {
      return project;
    }

    throw new ForbiddenException('Access denied to this project');
  }

  async findByProject(projectId: string, user: User) {
    await this.checkProjectAccess(projectId, user);

    return this.prisma.finding.findMany({
      where: { projectId },
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
    });
  }

  async findOne(id: string, user: User) {
    const finding = await this.prisma.finding.findUnique({
      where: { id },
      include: {
        vulnerability: true,
        project: { include: { tester: true, tl: true } },
        pocSteps: {
          orderBy: { stepNo: 'asc' },
        },
      },
    });

    if (!finding) {
      throw new NotFoundException('Finding not found');
    }

    await this.checkProjectAccess(finding.projectId, user);
    return finding;
  }

  async create(data: {
    projectId: string;
    vulnId: string;
    testerNotes: string;
    evidencePaths?: string[];
    affectedInstances?: string[];
    authenticationType?: string;
    proofOfConcept?: string;
    vulnerabilityDependency?: string;
    reportStatus?: string;
    cvssScoreOverride?: number;
    cvssVectorOverride?: string;
  }, user: User, ipAddress: string, userAgent: string) {
    const project = await this.checkProjectAccess(data.projectId, user);

    if (user.role === UserRole.TESTER && project.testerId !== user.id) {
      throw new ForbiddenException('Cannot add findings to this project');
    }

    const finding = await this.prisma.finding.create({
      data: {
        projectId: data.projectId,
        vulnId: data.vulnId,
        testerNotes: data.testerNotes,
        evidencePaths: data.evidencePaths || [],
        affectedInstances: data.affectedInstances || [],
        authenticationType: data.authenticationType,
        proofOfConcept: data.proofOfConcept,
        vulnerabilityDependency: data.vulnerabilityDependency,
        reportStatus: data.reportStatus || 'Open',
        cvssScoreOverride: data.cvssScoreOverride,
        cvssVectorOverride: data.cvssVectorOverride,
        createdById: user.id,
        status: FindingStatus.DRAFT,
      },
      include: { vulnerability: true, pocSteps: true },
    });

    // Auto-update project status: NOT_STARTED -> IN_PROGRESS
    if (project.status === ProjectStatus.NOT_STARTED) {
      await this.prisma.project.update({
        where: { id: data.projectId },
        data: { status: ProjectStatus.IN_PROGRESS },
      });
    }

    await this.auditService.log({
      actorId: user.id,
      action: 'PROJECT_UPDATED',
      targetType: 'FINDING',
      targetId: finding.id,
      ipAddress,
      userAgent,
      details: { projectId: data.projectId, vulnId: data.vulnId },
    });

    return finding;
  }

  async update(id: string, data: any, user: User, ipAddress: string, userAgent: string) {
    const finding = await this.prisma.finding.findUnique({
      where: { id },
      include: { project: { include: { tester: true } } },
    });

    if (!finding) {
      throw new NotFoundException('Finding not found');
    }

    await this.checkProjectAccess(finding.projectId, user);

    if (user.role === UserRole.TESTER) {
      if (finding.createdById !== user.id || finding.status !== FindingStatus.DRAFT) {
        throw new ForbiddenException('Cannot edit this finding');
      }
    }

    const updated = await this.prisma.finding.update({
      where: { id },
      data: {
        ...(data.testerNotes !== undefined && { testerNotes: data.testerNotes }),
        ...(data.evidencePaths !== undefined && { evidencePaths: data.evidencePaths }),
        ...(data.affectedInstances !== undefined && { affectedInstances: data.affectedInstances }),
        ...(data.authenticationType !== undefined && { authenticationType: data.authenticationType }),
        ...(data.proofOfConcept !== undefined && { proofOfConcept: data.proofOfConcept }),
        ...(data.vulnerabilityDependency !== undefined && { vulnerabilityDependency: data.vulnerabilityDependency }),
        ...(data.reportStatus !== undefined && { reportStatus: data.reportStatus }),
        ...(data.cvssScoreOverride !== undefined && { cvssScoreOverride: data.cvssScoreOverride }),
        ...(data.cvssVectorOverride !== undefined && { cvssVectorOverride: data.cvssVectorOverride }),
        ...(data.status !== undefined && { status: data.status }),
      },
      include: { vulnerability: true, pocSteps: true },
    });

    await this.auditService.log({
      actorId: user.id,
      action: 'PROJECT_UPDATED',
      targetType: 'FINDING',
      targetId: id,
      ipAddress,
      userAgent,
      details: data,
    });

    return updated;
  }

  async remove(id: string, user: User, ipAddress: string, userAgent: string) {
    const finding = await this.prisma.finding.findUnique({
      where: { id },
      include: { project: true },
    });

    if (!finding) {
      throw new NotFoundException('Finding not found');
    }

    await this.checkProjectAccess(finding.projectId, user);

    if (user.role === UserRole.TESTER && finding.createdById !== user.id) {
      throw new ForbiddenException('Cannot delete this finding');
    }

    await this.prisma.finding.delete({ where: { id } });

    await this.auditService.log({
      actorId: user.id,
      action: 'PROJECT_UPDATED',
      targetType: 'FINDING',
      targetId: id,
      ipAddress,
      userAgent,
      details: { deleted: true },
    });

    return { message: 'Finding deleted successfully' };
  }

  async addPocStep(findingId: string, data: { stepNo: number; description: string; imagePath?: string }, user: User) {
    const finding = await this.prisma.finding.findUnique({
      where: { id: findingId },
      include: { project: true },
    });

    if (!finding) {
      throw new NotFoundException('Finding not found');
    }

    await this.checkProjectAccess(finding.projectId, user);

    if (user.role === UserRole.TESTER && finding.createdById !== user.id) {
      throw new ForbiddenException('Cannot modify this finding');
    }

    return this.prisma.pocStep.create({
      data: {
        findingId,
        stepNo: data.stepNo,
        description: data.description,
        imagePath: data.imagePath,
      },
    });
  }

  async updatePocStep(findingId: string, stepId: string, data: { stepNo?: number; description?: string; imagePath?: string }, user: User) {
    const finding = await this.prisma.finding.findUnique({
      where: { id: findingId },
      include: { project: true },
    });

    if (!finding) {
      throw new NotFoundException('Finding not found');
    }

    await this.checkProjectAccess(finding.projectId, user);

    const step = await this.prisma.pocStep.findUnique({ where: { id: stepId } });
    if (!step || step.findingId !== findingId) {
      throw new NotFoundException('POC step not found');
    }

    return this.prisma.pocStep.update({
      where: { id: stepId },
      data: {
        ...(data.stepNo !== undefined && { stepNo: data.stepNo }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.imagePath !== undefined && { imagePath: data.imagePath }),
      },
    });
  }

  async removePocStep(findingId: string, stepId: string, user: User) {
    const finding = await this.prisma.finding.findUnique({
      where: { id: findingId },
      include: { project: true },
    });

    if (!finding) {
      throw new NotFoundException('Finding not found');
    }

    await this.checkProjectAccess(finding.projectId, user);

    const step = await this.prisma.pocStep.findUnique({ where: { id: stepId } });
    if (!step || step.findingId !== findingId) {
      throw new NotFoundException('POC step not found');
    }

    await this.prisma.pocStep.delete({ where: { id: stepId } });
    return { message: 'POC step deleted' };
  }
}
