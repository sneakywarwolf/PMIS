import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { User, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FindingsService } from './findings.service';
import { FortifyFinding, fortifyPocText, parseFortifyFile } from '../common/fortify-parser.util';

/** new: can be imported · duplicate: already in this project · merge: already imported, this file adds locations · invalid: the file's record can't be imported */
export type FortifyImportStatus = 'new' | 'duplicate' | 'merge' | 'invalid';

const SOURCE = 'fortify';
const FILL = 'Not provided by Fortify.';

/**
 * Fortify (SCR) import. Same shape as the Nessus import: findings become project-scoped records (source
 * 'fortify') plus a normal Finding created through FindingsService.create(), so nothing touches the global
 * Vulnerability DB and no approval requests are made. The file is parsed in memory and never stored.
 */
@Injectable()
export class FortifyImportService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private findings: FindingsService,
  ) {}

  private async plan(projectId: string, file: Express.Multer.File | undefined, user: User) {
    const project = await this.findings.checkProjectAccess(projectId, user);
    if (project.subType !== 'SCR') throw new BadRequestException('Fortify import is only available for SCR projects');
    if (user.role === UserRole.TESTER && project.testerId !== user.id) throw new ForbiddenException('Cannot add findings to this project');
    const parsed = await parseFortifyFile(file);

    const [scoped, existing] = await Promise.all([
      this.prisma.projectVulnerability.findMany({
        where: { projectId, source: SOURCE },
        select: { sourceKey: true, findings: { select: { affectedInstances: true } } },
      }),
      this.prisma.finding.findMany({
        where: { projectId },
        select: { vulnerability: { select: { name: true } }, projectVulnerability: { select: { name: true } } },
      }),
    ]);
    const knownLocations = new Map<string, Set<string>>();
    for (const v of scoped) {
      if ((v.findings ?? []).length === 0) continue; // its finding was deleted: nothing to merge into
      const set = knownLocations.get(v.sourceKey) ?? new Set<string>();
      v.findings.forEach((f) => f.affectedInstances.forEach((l) => set.add(l)));
      knownLocations.set(v.sourceKey, set);
    }
    const importedKeys = new Set(scoped.map((v) => v.sourceKey));
    const names = new Set(existing.map((f) => (f.vulnerability ?? f.projectVulnerability)!.name.trim().toLowerCase()));

    const items = parsed.findings.map((item) => ({
      ...item,
      status: (item.problem
        ? 'invalid'
        : importedKeys.has(item.key)
          ? knownLocations.has(item.key) && item.affected.some((l) => !knownLocations.get(item.key)!.has(l)) ? 'merge' : 'duplicate'
          : names.has(item.name.trim().toLowerCase()) ? 'duplicate' : 'new') as FortifyImportStatus,
    }));
    return { items, parsed };
  }

  async preview(projectId: string, file: Express.Multer.File | undefined, user: User) {
    const { items, parsed } = await this.plan(projectId, file, user);
    return {
      // The long texts and the trace are not shown in the preview.
      items: items.map(({ trace, description, impact, remediation, references, ...rest }) => ({ ...rest, hasTrace: !!trace })),
      activeInstances: parsed.activeInstances,
      suppressedInstances: parsed.suppressedInstances,
      suppressionApplied: parsed.suppressionApplied,
    };
  }

  private async mergeLocations(projectId: string, item: FortifyFinding, user: User, ipAddress: string, userAgent: string) {
    const records = await this.prisma.projectVulnerability.findMany({
      where: { projectId, source: SOURCE, sourceKey: item.key },
      select: { findings: { where: { projectId }, select: { id: true, affectedInstances: true } } },
    });
    for (const finding of records.flatMap((r) => r.findings)) {
      const added = item.affected.filter((l) => !finding.affectedInstances.includes(l));
      if (added.length === 0) continue;
      await this.prisma.finding.update({ where: { id: finding.id }, data: { affectedInstances: [...finding.affectedInstances, ...added] } });
      await this.auditService.log({
        actorId: user.id,
        action: 'PROJECT_UPDATED',
        targetType: 'FINDING',
        targetId: finding.id,
        ipAddress,
        userAgent,
        details: { fortifyInstancesAdded: added.length },
      });
    }
  }

  async import(projectId: string, file: Express.Multer.File | undefined, selected: string[], user: User, ipAddress: string, userAgent: string) {
    if (selected.length === 0) throw new BadRequestException('Select at least one finding to import');
    const { items } = await this.plan(projectId, file, user);
    const byKey = new Map(items.map((i) => [i.key, i]));
    const result = {
      created: [] as { key: string; name: string; findingId: string }[],
      skipped: [] as { key: string; name: string; reason: string }[],
      merged: [] as { key: string; name: string }[],
      failed: [] as { key: string; name: string; error: string }[],
    };

    for (const key of new Set(selected)) {
      const item = byKey.get(key);
      if (!item) {
        result.failed.push({ key, name: key, error: 'Not found in the uploaded file' });
        continue;
      }
      if (item.status === 'invalid') {
        result.failed.push({ key, name: item.name, error: item.problem! });
        continue;
      }
      if (item.status === 'duplicate') {
        result.skipped.push({ key, name: item.name, reason: 'Already in this project' });
        continue;
      }
      if (item.status === 'merge') {
        try {
          await this.mergeLocations(projectId, item, user, ipAddress, userAgent);
          result.merged.push({ key, name: item.name });
        } catch (e: any) {
          result.failed.push({ key, name: item.name, error: e.message || 'Merge failed' });
        }
        continue;
      }
      let projectVulnId: string | undefined;
      try {
        const record = await this.prisma.projectVulnerability.create({
          data: {
            projectId,
            source: SOURCE,
            classification: 'SCR Finding',
            sourceKey: item.key,
            name: item.name,
            severity: item.severity,
            // Fortify supplies no CVSS score or vector; none is made up.
            description: item.description || FILL,
            impact: item.impact || FILL,
            remediation: item.remediation || FILL,
            references: item.references || FILL,
            cveId: item.cveId,
            cweId: item.cweId,
          },
        });
        projectVulnId = record.id;
        const finding = await this.findings.create(
          { projectId, projectVulnId, testerNotes: 'Imported from Fortify.', affectedInstances: item.affected, proofOfConcept: fortifyPocText(item) ?? undefined },
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
}
