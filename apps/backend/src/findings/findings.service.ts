import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { VulnerabilitiesService } from '../vulnerabilities/vulnerabilities.service';
import { User, UserRole, FindingStatus, ProjectStatus, VulnerabilityStatus } from '@prisma/client';
import { getPocReadiness, isFindingReportReady } from '../common/poc-validation.util';
import { parseNessusFile, NessusFinding } from '../common/nessus-parser.util';

/**
 * ready              matches an approved library entry: the finding is created directly
 * new-library-entry  no match, importer is an Admin: library entry is created (existing Admin-only path), then the finding
 * needs-approval     no match, importer is not an Admin: a library request is filed; the finding is NOT created until it is approved
 * awaiting-approval  a library request with the same name is already pending
 * duplicate          this project already has the finding
 */
export type NessusImportStatus = 'ready' | 'new-library-entry' | 'needs-approval' | 'awaiting-approval' | 'duplicate';

@Injectable()
export class FindingsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private vulnerabilitiesService: VulnerabilitiesService,
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
  // Uploaded files are parsed server-side as data only. Findings are created through
  // `create()`, so project access, tester ownership, DRAFT status and audit logging are
  // unchanged. Library entries follow the existing rules: Admin creates directly,
  // everyone else files a request that needs approval.

  private static readonly NESSUS_FILL = 'Not provided by Nessus.';

  private nessusMarker(key: string) {
    return `[Nessus plugin ${key}]`;
  }

  private async nessusPlan(projectId: string, file: Express.Multer.File | undefined, user: User) {
    const project = await this.checkProjectAccess(projectId, user);
    if (project.subType !== 'NETWORK') {
      throw new BadRequestException('Nessus import is only available for Network projects');
    }
    if (user.role === UserRole.TESTER && project.testerId !== user.id) {
      throw new ForbiddenException('Cannot add findings to this project');
    }
    const parsed = parseNessusFile(file);

    const [library, pending, existing] = await Promise.all([
      this.prisma.vulnerability.findMany({
        where: { status: VulnerabilityStatus.APPROVED, isActive: true },
        select: { id: true, name: true, cveId: true, cvssScore: true },
      }),
      this.prisma.vulnerability.findMany({
        where: { status: VulnerabilityStatus.PENDING, isActive: true },
        select: { name: true },
      }),
      this.prisma.finding.findMany({ where: { projectId }, select: { vulnId: true, testerNotes: true } }),
    ]);
    const byName = new Map(library.map((v) => [v.name.trim().toLowerCase(), v]));
    const byCve = new Map(library.filter((v) => v.cveId).map((v) => [v.cveId!.trim().toLowerCase(), v]));
    const pendingNames = new Set(pending.map((v) => v.name.trim().toLowerCase()));

    const items = parsed.map((item) => {
      const match = byName.get(item.name.trim().toLowerCase()) ?? (item.cveId ? byCve.get(item.cveId.toLowerCase()) : undefined);
      const marker = this.nessusMarker(item.key);
      let status: NessusImportStatus;
      if (existing.some((f) => (match && f.vulnId === match.id) || f.testerNotes.includes(marker))) status = 'duplicate';
      else if (match) status = 'ready';
      else if (pendingNames.has(item.name.trim().toLowerCase())) status = 'awaiting-approval';
      else status = user.role === UserRole.ADMIN ? 'new-library-entry' : 'needs-approval';
      return { ...item, status, matchedVulnId: match?.id ?? null, matchedCvssScore: match?.cvssScore ?? null };
    });
    return { items };
  }

  async previewNessus(projectId: string, file: Express.Multer.File | undefined, user: User) {
    const { items } = await this.nessusPlan(projectId, file, user);
    return { items: items.map(({ matchedCvssScore, ...item }) => item) };
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
      requested: [] as { key: string; name: string }[],
      skipped: [] as { key: string; name: string; reason: string }[],
      failed: [] as { key: string; name: string; error: string }[],
    };

    for (const key of new Set(selected)) {
      const item = byKey.get(key);
      if (!item) {
        result.failed.push({ key, name: key, error: 'Not found in the uploaded file' });
        continue;
      }
      try {
        if (item.status === 'duplicate') {
          result.skipped.push({ key, name: item.name, reason: 'Already in this project' });
        } else if (item.status === 'awaiting-approval') {
          result.skipped.push({ key, name: item.name, reason: 'A library request for it is already awaiting approval' });
        } else if (item.status === 'needs-approval') {
          await this.vulnerabilitiesService.request(this.libraryFields(item), user.id);
          result.requested.push({ key, name: item.name });
        } else {
          const vulnId =
            item.matchedVulnId ?? (await this.vulnerabilitiesService.create(this.libraryFields(item), user.id)).id;
          const scoreDiffers = item.cvssScore !== null && item.cvssScore !== item.matchedCvssScore;
          const finding = await this.create(
            {
              projectId,
              vulnId,
              testerNotes: `Imported from Nessus. ${this.nessusMarker(key)}`,
              affectedInstances: item.affected,
              ...(scoreDiffers && { cvssScoreOverride: item.cvssScore!, cvssVectorOverride: item.cvssVector ?? undefined }),
            },
            user,
            ipAddress,
            userAgent,
          );
          result.created.push({ key, name: item.name, findingId: finding.id });
        }
      } catch (e: any) {
        result.failed.push({ key, name: item.name, error: e.message || 'Import failed' });
      }
    }
    return result;
  }

  private libraryFields(item: NessusFinding) {
    const fill = FindingsService.NESSUS_FILL;
    return {
      name: item.name,
      severity: item.severity,
      cvssScore: item.cvssScore ?? undefined,
      cvssVector: item.cvssVector ?? undefined,
      description: item.description || fill,
      impact: item.impact || fill,
      remediation: item.remediation || fill,
      references: item.references || fill,
      cveId: item.cveId ?? undefined,
      cweId: item.cweId ?? undefined,
      category: 'NETWORK',
    };
  }

  async findByProject(projectId: string, user: User) {
    await this.checkProjectAccess(projectId, user);

    const findings = await this.prisma.finding.findMany({
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

    return findings.map((f) => ({ ...f, pocComplete: isFindingReportReady(f.pocSteps), pocReadiness: getPocReadiness(f.pocSteps) }));
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
    return { ...finding, pocComplete: isFindingReportReady(finding.pocSteps), pocReadiness: getPocReadiness(finding.pocSteps) };
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
