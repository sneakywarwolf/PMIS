import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { VULN_INCLUDE, withVulnerability, bySeverityScore } from '../common/finding-vulnerability.util';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { User, UserRole, FindingStatus, ProjectStatus } from '@prisma/client';
import { getPocReadiness, isFindingReportReady } from '../common/poc-validation.util';
import { parseNessusFile } from '../common/nessus-parser.util';

/** new: can be imported · duplicate: this project already has it (same Nessus plugin or same name) */
export type NessusImportStatus = 'new' | 'duplicate';

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

  // ─── Nessus import (VA findings for Network projects) ───
  // Imported findings are PROJECT-SCOPED: each becomes a ProjectVulnerability owned by this
  // project plus a normal Finding pointing at it. Nothing is written to, or matched against, the
  // global Vulnerability DB, so no library entries or approvals are involved and other projects
  // never see these records. The Finding itself goes through `create()` (access checks, tester
  // ownership, DRAFT status, audit) like any other finding.

  private static readonly NESSUS_FILL = 'Not provided by Nessus.';

  private async nessusPlan(projectId: string, file: Express.Multer.File | undefined, user: User) {
    const project = await this.checkProjectAccess(projectId, user);
    if (project.subType !== 'NETWORK') {
      throw new BadRequestException('Nessus import is only available for Network projects');
    }
    if (user.role === UserRole.TESTER && project.testerId !== user.id) {
      throw new ForbiddenException('Cannot add findings to this project');
    }
    const parsed = parseNessusFile(file);

    // Duplicate = same Nessus plugin already imported here, or a finding with the same name already in this project.
    const [scoped, existing] = await Promise.all([
      this.prisma.projectVulnerability.findMany({ where: { projectId, source: 'nessus' }, select: { sourceKey: true } }),
      this.prisma.finding.findMany({
        where: { projectId },
        select: { vulnerability: { select: { name: true } }, projectVulnerability: { select: { name: true } } },
      }),
    ]);
    const imported = new Set(scoped.map((v) => v.sourceKey));
    const names = new Set(existing.map((f) => (f.vulnerability ?? f.projectVulnerability)!.name.trim().toLowerCase()));

    const items = parsed.map((item) => ({
      ...item,
      status: (imported.has(item.key) || names.has(item.name.trim().toLowerCase()) ? 'duplicate' : 'new') as NessusImportStatus,
    }));
    return { items };
  }

  async previewNessus(projectId: string, file: Express.Multer.File | undefined, user: User) {
    return this.nessusPlan(projectId, file, user);
  }

  async importNessus(
    projectId: string,
    file: Express.Multer.File | undefined,
    selected: string[],
    user: User,
    ipAddress: string,
    userAgent: string,
  ) {
    if (selected.length === 0) throw new BadRequestException('Select at least one finding to import');
    const { items } = await this.nessusPlan(projectId, file, user);
    const byKey = new Map(items.map((i) => [i.key, i]));
    const result = {
      created: [] as { key: string; name: string; findingId: string }[],
      skipped: [] as { key: string; name: string; reason: string }[],
      failed: [] as { key: string; name: string; error: string }[],
    };

    for (const key of new Set(selected)) {
      const item = byKey.get(key);
      if (!item) {
        result.failed.push({ key, name: key, error: 'Not found in the uploaded file' });
        continue;
      }
      if (item.status === 'duplicate') {
        result.skipped.push({ key, name: item.name, reason: 'Already in this project' });
        continue;
      }
      let projectVulnId: string | undefined;
      try {
        const fill = FindingsService.NESSUS_FILL;
        const record = await this.prisma.projectVulnerability.create({
          data: {
            projectId,
            source: 'nessus',
            sourceKey: item.key,
            name: item.name,
            severity: item.severity,
            cvssScore: item.cvssScore,
            cvssVector: item.cvssVector,
            description: item.description || fill,
            impact: item.impact || fill,
            remediation: item.remediation || fill,
            references: item.references || fill,
            cveId: item.cveId,
            cweId: item.cweId,
          },
        });
        projectVulnId = record.id;
        const finding = await this.create(
          { projectId, projectVulnId, testerNotes: 'Imported from Nessus.', affectedInstances: item.affected },
          user,
          ipAddress,
          userAgent,
        );
        result.created.push({ key, name: item.name, findingId: finding.id });
      } catch (e: any) {
        // Don't leave an orphaned project record behind if the finding could not be created.
        if (projectVulnId) await this.prisma.projectVulnerability.deleteMany({ where: { id: projectVulnId } });
        result.failed.push({ key, name: item.name, error: e.message || 'Import failed' });
      }
    }
    return result;
  }

  async findByProject(projectId: string, user: User) {
    await this.checkProjectAccess(projectId, user);

    const findings = await this.prisma.finding.findMany({
      where: { projectId },
      include: {
        ...VULN_INCLUDE,
        pocSteps: {
          orderBy: { stepNo: 'asc' },
        },
      },
    });

    return findings.map(withVulnerability).sort(bySeverityScore).map((f) => ({ ...f, pocComplete: isFindingReportReady(f.pocSteps), pocReadiness: getPocReadiness(f.pocSteps) }));
  }

  async findOne(id: string, user: User) {
    const finding = await this.prisma.finding.findUnique({
      where: { id },
      include: {
        ...VULN_INCLUDE,
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
    return { ...withVulnerability(finding), pocComplete: isFindingReportReady(finding.pocSteps), pocReadiness: getPocReadiness(finding.pocSteps) };
  }

  async create(data: {
    projectId: string;
    vulnId?: string;
    // Set instead of vulnId for project-scoped records (scan imports); never both.
    projectVulnId?: string;
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
        projectVulnId: data.projectVulnId,
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
      include: { ...VULN_INCLUDE, pocSteps: true },
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

    return withVulnerability(finding);
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
      include: { ...VULN_INCLUDE, pocSteps: true },
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

    return withVulnerability(updated);
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
    // A project-scoped vulnerability record only exists for its finding; drop it so the import can be redone.
    if (finding.projectVulnId) await this.prisma.projectVulnerability.deleteMany({ where: { id: finding.projectVulnId } });

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
