import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { VULN_INCLUDE, withVulnerability, bySeverityScore } from '../common/finding-vulnerability.util';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { User, UserRole, FindingStatus, ProjectStatus } from '@prisma/client';
import { resolveCvssVector } from '../common/cvss-vector.util';
import { findingPocReadiness } from '../common/poc-validation.util';
import { NESSUS_POC_MAX, parseNessusFile } from '../common/nessus-parser.util';
import type { ScanUpload } from '../common/nessus-upload.storage';
import { assertPocKey, assertPocKeys } from '../common/upload-security.util';
import { splitPocImagePaths } from '../common/poc-images.util';
import { StorageService } from '../reports/storage.service';

/** new: can be imported · duplicate: this project already has it (same Nessus plugin or same name) · merge: same plugin already imported, but this file adds affected hosts */
// 'refresh' = already imported, but its plugin output was not captured then (older import): the same file can add it.
export type NessusImportStatus = 'new' | 'duplicate' | 'refresh' | 'merge';

@Injectable()
export class FindingsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private storage: StorageService,
  ) {}

  async checkProjectAccess(projectId: string, user: User) {
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
    // An uploaded .nessus arrives already parsed (streamed, never kept); a .csv or a plain buffer is parsed here.
    const parsed = (file as ScanUpload | undefined)?.scan ?? parseNessusFile(file);

    // Duplicate = same Nessus plugin already imported here, or a finding with the same name already in this project.
    const [scoped, existing] = await Promise.all([
      this.prisma.projectVulnerability.findMany({
        where: { projectId, source: 'nessus' },
        select: { sourceKey: true, findings: { select: { proofOfConcept: true, affectedInstances: true } } },
      }),
      this.prisma.finding.findMany({
        where: { projectId },
        select: { vulnerability: { select: { name: true } }, projectVulnerability: { select: { name: true } } },
      }),
    ]);
    const imported = new Set(scoped.map((v) => v.sourceKey));
    const lacksOutput = new Set(scoped.filter((v) => (v.findings ?? []).some((f) => !f.proofOfConcept)).map((v) => v.sourceKey));
    const knownHosts = new Map<string, Set<string>>();
    for (const v of scoped) {
      const set = knownHosts.get(v.sourceKey!) ?? new Set<string>();
      (v.findings ?? []).forEach((f) => (f.affectedInstances ?? []).forEach((h) => set.add(h)));
      if ((v.findings ?? []).length > 0) knownHosts.set(v.sourceKey!, set); // a record whose finding was deleted has nothing to merge into
    }
    const names = new Set(existing.map((f) => (f.vulnerability ?? f.projectVulnerability)!.name.trim().toLowerCase()));

    const items = parsed.map((item) => ({
      ...item,
      status: (imported.has(item.key)
        ? (knownHosts.has(item.key) && item.affected.some((h) => !knownHosts.get(item.key)!.has(h)) ? 'merge'
          : item.pluginOutputs.length > 0 && lacksOutput.has(item.key) ? 'refresh' : 'duplicate')
        : names.has(item.name.trim().toLowerCase()) ? 'duplicate' : 'new') as NessusImportStatus,
    }));
    return { items, exposure: project.externalInternal };
  }

  async previewNessus(projectId: string, file: Express.Multer.File | undefined, user: User) {
    const { items, exposure } = await this.nessusPlan(projectId, file, user);
    // Plugin outputs can be large and are not shown in the preview.
    return { items: items.map(({ pluginOutputs, ...rest }) => rest), exposure };
  }

  static readonly NESSUS_POC_STEP = 'Observe the output.';
  private static readonly NESSUS_POC_MAX = NESSUS_POC_MAX;

  /** Plugin output as captured; with several hosts each block is headed by its host:port. Null when the scan has none. */
  static nessusPocText(outputs: { at: string; text: string }[]): string | null {
    if (!outputs.length) return null;
    const text = outputs.length === 1 ? outputs[0].text : outputs.map((o) => `[${o.at}]\n${o.text}`).join('\n\n');
    // ponytail: hard cap keeps one chatty plugin from bloating the DB and the report; marked, never silent.
    return text.length > FindingsService.NESSUS_POC_MAX ? text.slice(0, FindingsService.NESSUS_POC_MAX) + '\n[output truncated]' : text;
  }

  /**
   * Older imports kept no plugin output. For a finding already imported from the same plugin, add the
   * output as its PoC and the single 'Observe the output.' step. Only findings with no PoC yet are touched,
   * only those two things are written, and an existing step is never duplicated or changed.
   */
  private async addNessusOutput(projectId: string, sourceKey: string, poc: string, user: User, ipAddress: string, userAgent: string) {
    const records = await this.prisma.projectVulnerability.findMany({
      where: { projectId, source: 'nessus', sourceKey },
      select: { findings: { where: { projectId }, select: { id: true, proofOfConcept: true, pocSteps: { select: { id: true } } } } },
    });
    for (const finding of records.flatMap((r) => r.findings)) {
      if (finding.proofOfConcept) continue;
      await this.prisma.finding.update({ where: { id: finding.id }, data: { proofOfConcept: poc } });
      if (finding.pocSteps.length === 0) {
        await this.prisma.pocStep.create({ data: { findingId: finding.id, stepNo: 1, description: FindingsService.NESSUS_POC_STEP } });
      }
      await this.auditService.log({
        actorId: user.id,
        action: 'PROJECT_UPDATED',
        targetType: 'FINDING',
        targetId: finding.id,
        ipAddress,
        userAgent,
        details: { nessusOutputAdded: true },
      });
    }
  }

  /**
   * Same plugin imported from another scan: add the hosts the finding doesn't have yet (union, nothing
   * removed or reordered) and, if the finding has no plugin output yet, the output too. Everything else on the
   * finding is left alone.
   */
  private async mergeNessusInstances(projectId: string, item: { key: string; affected: string[]; pluginOutputs: { at: string; text: string }[] }, user: User, ipAddress: string, userAgent: string) {
    const records = await this.prisma.projectVulnerability.findMany({
      where: { projectId, source: 'nessus', sourceKey: item.key },
      select: { findings: { where: { projectId }, select: { id: true, affectedInstances: true } } },
    });
    for (const finding of records.flatMap((r) => r.findings)) {
      const added = item.affected.filter((h) => !finding.affectedInstances.includes(h));
      if (added.length === 0) continue;
      await this.prisma.finding.update({ where: { id: finding.id }, data: { affectedInstances: [...finding.affectedInstances, ...added] } });
      await this.auditService.log({
        actorId: user.id,
        action: 'PROJECT_UPDATED',
        targetType: 'FINDING',
        targetId: finding.id,
        ipAddress,
        userAgent,
        details: { nessusInstancesAdded: added },
      });
    }
    if (item.pluginOutputs.length > 0) {
      await this.addNessusOutput(projectId, item.key, FindingsService.nessusPocText(item.pluginOutputs)!, user, ipAddress, userAgent);
    }
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
    const { items, exposure } = await this.nessusPlan(projectId, file, user);
    const byKey = new Map(items.map((i) => [i.key, i]));
    const result = {
      created: [] as { key: string; name: string; findingId: string }[],
      skipped: [] as { key: string; name: string; reason: string }[],
      failed: [] as { key: string; name: string; error: string }[],
      refreshed: [] as { key: string; name: string }[],
      merged: [] as { key: string; name: string }[],
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
      if (item.status === 'merge') {
        try {
          await this.mergeNessusInstances(projectId, item, user, ipAddress, userAgent);
          result.merged.push({ key, name: item.name });
        } catch (e: any) {
          result.failed.push({ key, name: item.name, error: e.message || 'Merge failed' });
        }
        continue;
      }
      if (item.status === 'refresh') {
        try {
          await this.addNessusOutput(projectId, item.key, FindingsService.nessusPocText(item.pluginOutputs)!, user, ipAddress, userAgent);
          result.refreshed.push({ key, name: item.name });
        } catch (e: any) {
          result.failed.push({ key, name: item.name, error: e.message || 'Update failed' });
        }
        continue;
      }
      let projectVulnId: string | undefined;
      try {
        const fill = FindingsService.NESSUS_FILL;
        // The score is kept as imported; only a missing vector is derived (see cvss-vector.util).
        const resolved = resolveCvssVector({ score: item.cvssScore, version: item.cvssVersion, existingVector: item.cvssVector, exposure });
        const record = await this.prisma.projectVulnerability.create({
          data: {
            projectId,
            source: 'nessus',
            classification: 'VA Finding',
            sourceKey: item.key,
            name: item.name,
            severity: item.severity,
            cvssScore: item.cvssScore,
            cvssVector: resolved.vector,
            cvssVectorSource: resolved.source,
            description: item.description || fill,
            impact: item.impact || fill,
            remediation: item.remediation || fill,
            references: item.references || fill,
            cveId: item.cveId,
            cweId: item.cweId,
          },
        });
        projectVulnId = record.id;
        const poc = FindingsService.nessusPocText(item.pluginOutputs);
        const finding = await this.create(
          { projectId, projectVulnId, testerNotes: 'Imported from Nessus.', affectedInstances: item.affected, proofOfConcept: poc ?? undefined },
          user,
          ipAddress,
          userAgent,
        );
        // Only when the scan has plugin output: one testing step pointing at it. No output, no step, nothing invented.
        if (poc) await this.prisma.pocStep.create({ data: { findingId: finding.id, stepNo: 1, description: FindingsService.NESSUS_POC_STEP } });
        result.created.push({ key, name: item.name, findingId: finding.id });
      } catch (e: any) {
        // Don't leave an orphaned project record behind if the finding could not be created.
        if (projectVulnId) await this.prisma.projectVulnerability.deleteMany({ where: { id: projectVulnId } });
        result.failed.push({ key, name: item.name, error: e.message || 'Import failed' });
      }
    }
    return result;
  }

  /**
   * The Nessus-imported VA findings of one project, identified by the project-scoped record's source
   * (never by name or severity). A tester can only touch findings they created, as with single delete.
   */
  private nessusFindingsWhere(projectId: string, user: User) {
    return {
      projectId,
      projectVulnerability: { is: { projectId, source: 'nessus' } },
      ...(user.role === UserRole.TESTER && { createdById: user.id }),
    };
  }

  async countNessusFindings(projectId: string, user: User) {
    await this.checkProjectAccess(projectId, user);
    return { count: await this.prisma.finding.count({ where: this.nessusFindingsWhere(projectId, user) }) };
  }

  /**
   * Deletes every Nessus-imported VA finding of this project in one transaction (project row locked, so
   * two bulk deletes can't interleave): the findings (their PoC steps cascade), then their now-unused
   * project-scoped vulnerability records. PT findings, the global Vulnerability DB, other projects, Nmap data,
   * scope and reports are never selected. Stored PoC/evidence files are removed after the commit, and only
   * those no remaining finding still points at. Repeating the call deletes nothing and returns 0.
   */
  async removeAllNessusFindings(projectId: string, user: User, ipAddress: string, userAgent: string) {
    await this.checkProjectAccess(projectId, user);

    const { deleted, files } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;
      const targets = await tx.finding.findMany({
        where: this.nessusFindingsWhere(projectId, user),
        select: { id: true, evidencePaths: true, pocSteps: { select: { imagePath: true } } },
      });
      if (targets.length === 0) return { deleted: 0, files: [] as string[] };

      const ids = targets.map((f) => f.id);
      const candidates = [...new Set(targets.flatMap((f) => [...f.evidencePaths, ...f.pocSteps.map((s) => s.imagePath ?? '')]).filter(Boolean))];

      const result = await tx.finding.deleteMany({ where: { id: { in: ids } } });
      // Records left without any finding (this delete, or an interrupted earlier import) go too; ones still in use stay.
      await tx.projectVulnerability.deleteMany({ where: { projectId, source: 'nessus', findings: { none: {} } } });

      // Only files nothing else references are safe to remove.
      const stillUsed = new Set<string>();
      if (candidates.length) {
        const [steps, evidence] = await Promise.all([
          tx.pocStep.findMany({ where: { imagePath: { in: candidates } }, select: { imagePath: true } }),
          tx.finding.findMany({ where: { evidencePaths: { hasSome: candidates } }, select: { evidencePaths: true } }),
        ]);
        steps.forEach((s) => stillUsed.add(s.imagePath!));
        evidence.forEach((f) => f.evidencePaths.forEach((p) => stillUsed.add(p)));
      }

      await this.auditService.log({
        actorId: user.id,
        action: 'PROJECT_UPDATED',
        targetType: 'PROJECT',
        targetId: projectId,
        ipAddress,
        userAgent,
        details: { bulkDeleteNessusFindings: true, deletedCount: result.count },
      });
      return { deleted: result.count, files: candidates.filter((p) => !stillUsed.has(p)) };
    });

    // Best effort after commit: a storage hiccup must not undo or fail a completed delete.
    for (const path of files) {
      try {
        await this.storage.deleteFile(path);
      } catch {
        // ponytail: orphaned file stays in storage; no retry queue.
      }
    }
    return { deleted };
  }

  async findByProject(projectId: string, user: User) {
    const project = await this.checkProjectAccess(projectId, user);

    const findings = await this.prisma.finding.findMany({
      where: { projectId },
      include: {
        ...VULN_INCLUDE,
        pocSteps: {
          orderBy: { stepNo: 'asc' },
        },
      },
    });

    return findings.map(withVulnerability).sort(bySeverityScore).map((f) => { const pocReadiness = findingPocReadiness(f, project.subType); return { ...f, pocComplete: pocReadiness === 'ready', pocReadiness }; });
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
    const shaped = withVulnerability(finding);
    const pocReadiness = findingPocReadiness(shaped, finding.project.subType);
    return { ...shaped, pocComplete: pocReadiness === 'ready', pocReadiness };
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

    // A finding has exactly one vulnerability source, and a project-scoped record must belong to this project
    // (the request body is client-controlled, so never trust a projectVulnId from it).
    if (!data.vulnId === !data.projectVulnId) {
      throw new BadRequestException('Provide exactly one of vulnId or projectVulnId');
    }
    if (data.projectVulnId) {
      const owned = await this.prisma.projectVulnerability.findFirst({
        where: { id: data.projectVulnId, projectId: data.projectId },
        select: { id: true },
      });
      if (!owned) throw new ForbiddenException('Invalid project vulnerability');
    }

    const finding = await this.prisma.finding.create({
      data: {
        projectId: data.projectId,
        vulnId: data.vulnId,
        projectVulnId: data.projectVulnId,
        testerNotes: data.testerNotes,
        evidencePaths: data.evidencePaths ? assertPocKeys(data.evidencePaths) : [],
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

    if (data.status !== undefined) {
      if (!Object.values(FindingStatus).includes(data.status)) throw new BadRequestException('Invalid status');
      if (user.role === UserRole.TESTER) throw new ForbiddenException('Testers cannot change finding status');
    }

    const updated = await this.prisma.finding.update({
      where: { id },
      data: {
        ...(data.testerNotes !== undefined && { testerNotes: data.testerNotes }),
        ...(data.evidencePaths !== undefined && { evidencePaths: assertPocKeys(data.evidencePaths) }),
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
    if (finding.projectVulnId) await this.prisma.projectVulnerability.deleteMany({ where: { id: finding.projectVulnId, projectId: finding.projectId } });

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

  /**
   * A PoC image belongs to exactly one step: refuse a file already attached to a different step, so evidence
   * can never be shared across findings or projects through a reused storage key.
   */
  private async assertPocImagesUnused(paths: string[], exceptStepId?: string) {
    if (paths.length === 0) return;
    const used = await this.prisma.pocStep.findFirst({
      where: {
        ...(exceptStepId && { id: { not: exceptStepId } }),
        OR: [{ imagePath: { in: paths } }, { extraImagePaths: { hasSome: paths } }],
      },
      select: { id: true },
    });
    if (used) throw new BadRequestException('A PoC image is already attached to another step.');
  }

  async addPocStep(findingId: string, data: { stepNo: number; description: string; imagePath?: string; imagePaths?: string[] }, user: User) {
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

    // `imagePaths` is the ordered list of PoCs; `imagePath` (one PoC) is still accepted as before.
    const images = data.imagePaths !== undefined
      ? splitPocImagePaths(data.imagePaths)
      : { imagePath: data.imagePath ? assertPocKey(data.imagePath) : null, extraImagePaths: [] as string[] };
    await this.assertPocImagesUnused([images.imagePath, ...images.extraImagePaths].filter((p): p is string => !!p));

    return this.prisma.pocStep.create({
      data: {
        findingId,
        stepNo: data.stepNo,
        description: data.description,
        imagePath: images.imagePath ?? undefined,
        extraImagePaths: images.extraImagePaths,
      },
    });
  }

  async updatePocStep(findingId: string, stepId: string, data: { stepNo?: number; description?: string; imagePath?: string; imagePaths?: string[] }, user: User) {
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

    // `imagePaths` replaces the whole ordered list (add, remove or reorder PoCs); a single `imagePath` keeps its
    // old meaning of "replace the first PoC" and leaves the others where they are.
    let images: { imagePath: string | null; extraImagePaths: string[] } | undefined;
    if (data.imagePaths !== undefined) {
      images = splitPocImagePaths(data.imagePaths);
    } else if (data.imagePath != null) {
      images = { imagePath: assertPocKey(data.imagePath), extraImagePaths: step.extraImagePaths };
    }
    if (images) {
      await this.assertPocImagesUnused([images.imagePath, ...images.extraImagePaths].filter((p): p is string => !!p), stepId);
    }

    return this.prisma.pocStep.update({
      where: { id: stepId },
      data: {
        ...(data.stepNo !== undefined && { stepNo: data.stepNo }),
        ...(data.description !== undefined && { description: data.description }),
        ...(images && { imagePath: images.imagePath, extraImagePaths: images.extraImagePaths }),
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
