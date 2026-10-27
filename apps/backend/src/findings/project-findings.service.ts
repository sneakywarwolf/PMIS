import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { FindingStatus, Prisma, ProjectStatus, User, UserRole, VulnerabilityStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { VulnerabilitiesService, normalizeVulnName } from '../vulnerabilities/vulnerabilities.service';
import { FindingsService } from './findings.service';
import { parseUploadedFileToCsv } from '../common/bulk-upload-file.util';
import { parseCsv, validateExactCsvHeaders } from '../common/csv-validation.util';
import { ProjectFindingFields, validateProjectFindingFields } from '../common/project-finding-fields.util';
import { VULN_INCLUDE, withVulnerability } from '../common/finding-vulnerability.util';

/** Largest findings file accepted (.csv / .xlsx). */
export const IMPORT_MAX_BYTES = 100 * 1024 * 1024;
/** Most data rows one import may carry. */
export const IMPORT_MAX_ROWS = 5000;
const ERROR_LIST_LIMIT = 200;

/** `ProjectVulnerability.source` of records created here; the backend uses it to keep them out of the global DB. */
export type ProjectOnlySource = 'manual' | 'import';

export type SyncOutcome =
  | { status: 'not_requested' }
  | { status: 'requested'; vulnerabilityId: string }
  | { status: 'already_pending' | 'already_exists'; vulnerabilityId: string }
  | { status: 'not_permitted' }
  | { status: 'failed'; message: string };

export interface ImportRowReport {
  row: number;
  name: string;
  severity: string;
  cvssScore: number | null;
  status: 'new' | 'duplicate' | 'invalid';
  errors?: string[];
}

interface ParsedRow {
  row: number;
  fields?: ProjectFindingFields;
  errors: string[];
  rawName: string;
}

/** Roles that may also ask for a vulnerability to be added to the global DB (same as POST /vulnerabilities/request). */
const SYNC_ROLES: UserRole[] = [UserRole.TESTER, UserRole.TEAM_LEAD, UserRole.ADMIN];

/**
 * Findings that belong to ONE project and were not picked from the Vulnerability DB: entered by hand, or imported
 * from a CSV/XLSX file. Each is a project-scoped record plus a normal Finding. Nothing here ever writes a global
 * Vulnerability, except the separate approval request a user explicitly asks for when adding one manually.
 */
@Injectable()
export class ProjectFindingsService {
  private readonly logger = new Logger(ProjectFindingsService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private settings: SettingsService,
    private vulnerabilities: VulnerabilitiesService,
    private findings: FindingsService,
  ) {}

  // ─── shared ───

  /** Same access rules as FindingsService.create(): project access, and a tester only on their own project. */
  private async projectFor(projectId: string, user: User) {
    if (!projectId || typeof projectId !== 'string') throw new BadRequestException('projectId is required');
    const project = await this.findings.checkProjectAccess(projectId, user);
    if (user.role === UserRole.TESTER && project.testerId !== user.id) {
      throw new ForbiddenException('Cannot add findings to this project');
    }
    return project;
  }

  private async severities(): Promise<string[]> {
    const { settings } = await this.settings.get();
    const labels = Object.keys(settings.workflow?.severityColors ?? {});
    return labels.length > 0 ? labels : ['Critical', 'High', 'Medium', 'Low', 'Info'];
  }

  /** Names already used by this project's findings, from either source (the duplicate rule Nessus import uses). */
  private async existingNames(projectId: string, db: Pick<PrismaService, 'finding'> = this.prisma): Promise<Set<string>> {
    const rows = await db.finding.findMany({
      where: { projectId },
      select: { vulnerability: { select: { name: true } }, projectVulnerability: { select: { name: true } } },
    });
    return new Set(rows.map((f) => normalizeVulnName((f.vulnerability ?? f.projectVulnerability)!.name)));
  }

  /**
   * Creates the project-scoped records and their findings in ONE transaction: either every item is saved or none.
   * Findings start as DRAFT with no Steps/PoC, like any other new finding.
   */
  private async insertAll(
    projectId: string,
    items: { fields: ProjectFindingFields; extra?: Partial<Prisma.FindingUncheckedCreateInput> }[],
    source: ProjectOnlySource,
    user: User,
  ) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Serialise concurrent imports/entries for one project so the duplicate check below cannot race.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`project-findings:${projectId}`}))`;
          const names = await this.existingNames(projectId, tx as any);
          const created: { id: string; name: string }[] = [];
          for (const { fields, extra } of items) {
            const key = normalizeVulnName(fields.name);
            if (names.has(key)) throw new ConflictException(`This project already has a finding named "${fields.name}".`);
            names.add(key);
            const record = await tx.projectVulnerability.create({
              data: {
                projectId,
                source,
                sourceKey: `name:${key}`,
                classification: 'PT Finding',
                name: fields.name,
                severity: fields.severity,
                cvssScore: fields.cvssScore,
                cvssVector: fields.cvssVector,
                description: fields.description,
                impact: fields.impact,
                remediation: fields.remediation,
                references: fields.references,
                cveId: fields.cveId,
                cweId: fields.cweId,
              },
            });
            const finding = await tx.finding.create({
              data: {
                testerNotes: '',
                evidencePaths: [],
                affectedInstances: [],
                reportStatus: 'Open',
                ...extra,
                projectId,
                projectVulnId: record.id,
                createdById: user.id,
                status: FindingStatus.DRAFT,
              },
              include: { ...VULN_INCLUDE, pocSteps: true },
            });
            created.push({ id: finding.id, name: fields.name });
            if (items.length === 1) return { created, finding };
          }
          return { created, finding: null };
        },
        { timeout: 120_000, maxWait: 10_000 },
      ).then(async (result) => {
        // Same first-finding status change FindingsService.create() makes, after the findings are safely saved.
        await this.prisma.project.updateMany({ where: { id: projectId, status: ProjectStatus.NOT_STARTED }, data: { status: ProjectStatus.IN_PROGRESS } });
        return result;
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException('This project already has a finding with that name (it may have just been added). Nothing was saved.');
      }
      throw e;
    }
  }

  // ─── Add Manually ───

  async createManual(body: any, user: User, ipAddress: string, userAgent: string) {
    if (!body || typeof body !== 'object') throw new BadRequestException('Invalid request');
    const project = await this.projectFor(body.projectId, user);

    // Sync Vuln DB defaults to ON; anything other than a real boolean is refused rather than guessed.
    if (body.syncVulnDb !== undefined && typeof body.syncVulnDb !== 'boolean') {
      throw new BadRequestException('syncVulnDb must be true or false');
    }
    const syncVulnDb = body.syncVulnDb !== false;

    const { value, errors } = validateProjectFindingFields(body, await this.severities());
    if (!value) throw new BadRequestException({ message: errors, error: 'Bad Request', statusCode: 400 });

    const extra = this.optionalFindingFields(body);
    const { finding } = await this.insertAll(project.id, [{ fields: value, extra }], 'manual', user);

    await this.audit.log({
      actorId: user.id,
      action: 'PROJECT_UPDATED',
      targetType: 'FINDING',
      targetId: finding!.id,
      ipAddress,
      userAgent,
      details: { projectId: project.id, source: 'manual', name: value.name, syncVulnDb },
    });

    // The project finding is already saved. The global-DB request is separate, and a problem with it never
    // undoes or blocks the finding.
    let sync: SyncOutcome = { status: 'not_requested' };
    if (syncVulnDb) {
      sync = await this.requestGlobalEntry(value, project.subType === 'NETWORK' ? 'NETWORK' : 'APPLICATION_API', user);
    }
    return { finding: withVulnerability(finding!), sync };
  }

  private optionalFindingFields(body: any): Partial<Prisma.FindingUncheckedCreateInput> {
    const str = (key: string, max: number): string | undefined => {
      const v = body[key];
      if (v === undefined || v === null || v === '') return undefined;
      if (typeof v !== 'string' || v.length > max) throw new BadRequestException(`${key} must be text of at most ${max} characters`);
      return v;
    };
    let affectedInstances: string[] | undefined;
    if (body.affectedInstances !== undefined) {
      const a = body.affectedInstances;
      if (!Array.isArray(a) || a.length > 1000 || a.some((x: unknown) => typeof x !== 'string' || x.length > 2000)) {
        throw new BadRequestException('affectedInstances must be a list of text values');
      }
      affectedInstances = a.map((x: string) => x.trim()).filter(Boolean);
    }
    return {
      ...(str('testerNotes', 20_000) !== undefined && { testerNotes: str('testerNotes', 20_000) }),
      ...(affectedInstances && { affectedInstances }),
      ...(str('authenticationType', 500) !== undefined && { authenticationType: str('authenticationType', 500) }),
      ...(str('vulnerabilityDependency', 5_000) !== undefined && { vulnerabilityDependency: str('vulnerabilityDependency', 5_000) }),
    };
  }

  /**
   * Asks for the vulnerability to be added to the global DB through the existing approval flow (a PENDING
   * Vulnerability, reviewed by Admin / the TL). It is never published directly. Retrying is safe: if the global DB
   * already has, or is already waiting on, an entry with that name, no second request is made.
   */
  private async requestGlobalEntry(fields: ProjectFindingFields, category: 'NETWORK' | 'APPLICATION_API', user: User): Promise<SyncOutcome> {
    if (!SYNC_ROLES.includes(user.role)) return { status: 'not_permitted' };
    try {
      const outcome = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`vuln-request:${normalizeVulnName(fields.name)}`}))`;
        const same = await tx.vulnerability.findFirst({
          where: { name: { equals: fields.name, mode: 'insensitive' }, isActive: true, status: { in: [VulnerabilityStatus.APPROVED, VulnerabilityStatus.PENDING] } },
          select: { id: true, status: true },
        });
        if (same) return { status: same.status === VulnerabilityStatus.PENDING ? 'already_pending' : 'already_exists', vulnerabilityId: same.id } as const;
        const vuln = await this.vulnerabilities.createRequest(
          tx as any,
          {
            name: fields.name,
            severity: fields.severity,
            cvssScore: fields.cvssScore ?? undefined,
            cvssVector: fields.cvssVector ?? undefined,
            description: fields.description,
            impact: fields.impact,
            remediation: fields.remediation,
            references: fields.references,
            cveId: fields.cveId ?? undefined,
            cweId: fields.cweId ?? undefined,
            category,
          },
          user.id,
        );
        return { status: 'requested', vulnerabilityId: vuln.id, vuln } as const;
      });
      if (outcome.status === 'requested') await this.vulnerabilities.announceRequest(outcome.vuln, user.id);
      return { status: outcome.status, vulnerabilityId: outcome.vulnerabilityId };
    } catch (e: any) {
      this.logger.error(`Vulnerability DB request for "${fields.name}" failed: ${e?.message}`);
      return { status: 'failed', message: 'The finding was added to the project, but the Vulnerability DB request could not be created. Ask an Admin to add it if it is needed.' };
    }
  }

  // ─── Import Project Findings (CSV / XLSX) ───

  getSampleCsv(): string {
    return this.vulnerabilities.getSampleCsv();
  }

  /** Reads and validates the whole file. Nothing is written. */
  private async parseImport(file: Express.Multer.File | undefined) {
    const csv = await parseUploadedFileToCsv(file, IMPORT_MAX_BYTES);
    const all = parseCsv(csv.trim());
    if (all.length < 2) throw new BadRequestException('The file has no data rows. Use the sample template: it has a header row followed by one row per finding.');
    const headers = all[0].map((h) => h.replace(/^﻿/, '').trim());
    validateExactCsvHeaders(headers, this.vulnerabilities.EXPECTED_HEADERS);

    const allowed = await this.severities();
    const rows: ParsedRow[] = [];
    for (let i = 1; i < all.length; i++) {
      const cols = all[i];
      if (cols.every((c) => c.trim() === '')) continue; // blank line
      if (rows.length >= IMPORT_MAX_ROWS) {
        throw new BadRequestException(`The file has more than ${IMPORT_MAX_ROWS} rows. Split it into smaller files.`);
      }
      if (cols.length > headers.length) {
        rows.push({ row: i + 1, errors: [`Row has ${cols.length} columns but the header has ${headers.length}. Check for an unescaped comma or quote.`], rawName: (cols[1] ?? '').trim() });
        continue;
      }
      while (cols.length < headers.length) cols.push('');
      const [, name, severity, cvssScore, cvssVector, description, impact, remediation, references, cveId, cweId] = cols;
      const { value, errors } = validateProjectFindingFields({ name, severity, cvssScore, cvssVector, description, impact, remediation, references, cveId, cweId }, allowed);
      rows.push({ row: i + 1, fields: value, errors, rawName: name.trim() });
    }
    if (rows.length === 0) throw new BadRequestException('The file has no data rows.');

    // Duplicate rows inside the file are errors, not silently merged.
    const firstSeen = new Map<string, number>();
    for (const r of rows) {
      if (!r.fields) continue;
      const key = normalizeVulnName(r.fields.name);
      const first = firstSeen.get(key);
      if (first !== undefined) r.errors.push(`Duplicates row ${first} ("${r.fields.name}").`);
      else firstSeen.set(key, r.row);
    }
    return rows;
  }

  private async classify(projectId: string, rows: ParsedRow[]): Promise<ImportRowReport[]> {
    const existing = await this.existingNames(projectId);
    return rows.map((r) => {
      const invalid = r.errors.length > 0 || !r.fields;
      return {
        row: r.row,
        name: r.fields?.name ?? r.rawName,
        severity: r.fields?.severity ?? '',
        cvssScore: r.fields?.cvssScore ?? null,
        status: invalid ? 'invalid' : existing.has(normalizeVulnName(r.fields!.name)) ? 'duplicate' : 'new',
        ...(invalid && { errors: r.errors }),
      };
    });
  }

  async previewImport(projectId: string, file: Express.Multer.File | undefined, user: User) {
    const project = await this.projectFor(projectId, user);
    const report = await this.classify(project.id, await this.parseImport(file));
    const invalid = report.filter((r) => r.status === 'invalid');
    return {
      total: report.length,
      newCount: report.filter((r) => r.status === 'new').length,
      duplicateCount: report.filter((r) => r.status === 'duplicate').length,
      invalidCount: invalid.length,
      canImport: invalid.length === 0 && report.some((r) => r.status === 'new'),
      rows: report.slice(0, ERROR_LIST_LIMIT + 300),
      truncated: report.length > ERROR_LIST_LIMIT + 300,
    };
  }

  async importFindings(projectId: string, file: Express.Multer.File | undefined, user: User, ipAddress: string, userAgent: string) {
    const project = await this.projectFor(projectId, user);
    // The file is read and checked again here: the preview is a convenience, never trusted.
    const parsed = await this.parseImport(file);
    const report = await this.classify(project.id, parsed);
    const invalid = report.filter((r) => r.status === 'invalid');
    if (invalid.length > 0) {
      throw new BadRequestException({
        message: `Nothing was imported: ${invalid.length} row(s) are invalid.`,
        errors: invalid.slice(0, ERROR_LIST_LIMIT).map((r) => ({ row: r.row, name: r.name, errors: r.errors })),
        statusCode: 400,
      });
    }
    const fresh = parsed.filter((r) => report.find((x) => x.row === r.row)!.status === 'new');
    if (fresh.length === 0) {
      throw new BadRequestException(`Nothing to import: all ${report.length} row(s) already exist in this project.`);
    }

    const { created } = await this.insertAll(project.id, fresh.map((r) => ({ fields: r.fields! })), 'import', user);
    const skipped = report.filter((r) => r.status === 'duplicate').map((r) => ({ row: r.row, name: r.name, reason: 'Already in this project' }));

    await this.audit.log({
      actorId: user.id,
      action: 'PROJECT_UPDATED',
      targetType: 'PROJECT',
      targetId: project.id,
      ipAddress,
      userAgent,
      details: { findingsImport: { source: 'import', fileName: file?.originalname?.slice(0, 200), created: created.length, skipped: skipped.length } },
    });
    return { created: created.length, skipped };
  }
}
