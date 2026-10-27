import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { stripCvssPrefix } from '../common/cvss-vector.util';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { UserRole, VulnerabilityStatus, NotificationType } from '@prisma/client';
import { validateExactCsvHeaders, parseCsv } from '../common/csv-validation.util';

/** Duplicate check key: case, leading/trailing and repeated spaces don't make a name different. */
export const normalizeVulnName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

@Injectable()
export class VulnerabilitiesService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private auditService: AuditService,
  ) {}

  async findAll(search?: string, severity?: string, category?: string, userRole?: UserRole, sortBy?: string, sortOrder?: string) {
    const where: any = {};

    if (userRole !== UserRole.ADMIN && userRole !== UserRole.AVP && userRole !== UserRole.TEAM_LEAD) {
      where.status = VulnerabilityStatus.APPROVED;
      where.isActive = true;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { cveId: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (severity) {
      where.severity = severity;
    }

    // Omitted (or "BOTH") searches across both categories — matches the
    // finding-add Category filter's "Both" option.
    if (category && category !== 'BOTH') {
      where.category = category;
    }

    const orderBy: any = {};
    const validSortFields = ['name', 'severity', 'cvssScore', 'cveId', 'cweId', 'createdAt'];
    if (sortBy && validSortFields.includes(sortBy)) {
      orderBy[sortBy] = sortOrder === 'asc' ? 'asc' : 'desc';
    } else {
      orderBy.cvssScore = 'desc';
    }

    return this.prisma.vulnerability.findMany({
      where,
      orderBy,
    });
  }

  async findPending() {
    return this.prisma.vulnerability.findMany({
      where: { status: VulnerabilityStatus.PENDING, isActive: true },
      include: {
        requestedBy: { select: { id: true, username: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const vuln = await this.prisma.vulnerability.findUnique({
      where: { id },
    });

    if (!vuln) {
      throw new NotFoundException('Vulnerability not found');
    }

    return vuln;
  }

  async create(data: {
    name: string;
    severity: string;
    cvssScore?: number;
    cvssVector?: string;
    description: string;
    impact: string;
    remediation: string;
    references: string;
    cveId?: string;
    cweId?: string;
    category?: string;
  }, actorId?: string) {
    const created = await this.prisma.vulnerability.create({ data: data as any });
    if (actorId) {
      await this.auditService.log({
        actorId,
        action: 'VULNERABILITY_CREATED',
        targetType: 'VULNERABILITY',
        targetId: created.id,
        ipAddress: 'unknown',
        userAgent: 'unknown',
        details: { name: created.name, severity: created.severity },
      });
    }
    return created;
  }

  // ─── Tester Edit Change Requests ───
  // A Tester's edit to an already-approved record never applies directly —
  // it's captured here and only takes effect once Admin or the tester's
  // specific TL approves it (see approveChangeRequest below).
  private readonly EDITABLE_FIELDS = [
    'name', 'severity', 'cvssScore', 'cvssVector', 'description', 'impact',
    'remediation', 'references', 'cveId', 'cweId', 'category',
  ];

  private snapshotEditableFields(vuln: any) {
    const snapshot: any = {};
    for (const field of this.EDITABLE_FIELDS) snapshot[field] = vuln[field];
    return snapshot;
  }

  async createChangeRequest(vulnerabilityId: string, data: any, requesterId: string) {
    const vuln = await this.prisma.vulnerability.findUnique({ where: { id: vulnerabilityId } });
    if (!vuln || !vuln.isActive) {
      throw new NotFoundException('Vulnerability not found');
    }

    const requester = await this.prisma.user.findUnique({
      where: { id: requesterId },
      select: { assignedTlId: true },
    });

    const afterData: any = {};
    for (const field of this.EDITABLE_FIELDS) {
      if (data[field] !== undefined) afterData[field] = data[field];
    }

    const changeRequest = await this.prisma.vulnerabilityChangeRequest.create({
      data: {
        vulnerabilityId,
        requestedById: requesterId,
        targetTlId: requester?.assignedTlId ?? null,
        beforeData: this.snapshotEditableFields(vuln),
        afterData,
      },
    });

    // Notify Admins + only this tester's specific TL — never every TL.
    const recipients = await this.prisma.user.findMany({
      where: {
        isActive: true,
        OR: [
          { role: UserRole.ADMIN },
          ...(requester?.assignedTlId ? [{ id: requester.assignedTlId }] : []),
        ],
      },
      select: { id: true },
    });
    await Promise.all(recipients.map((r) =>
      this.notificationsService.create({
        userId: r.id,
        type: NotificationType.VULNERABILITY_CHANGE_REQUESTED,
        title: 'Vulnerability Edit Requested',
        message: `An edit to "${vuln.name}" is pending approval.`,
        relatedId: changeRequest.id,
      }),
    ));

    return changeRequest;
  }

  /** Admin sees every pending edit request; a TL/AVP only sees requests routed to them. */
  async findPendingChangeRequests(user: { id: string; role: UserRole }) {
    const where: any = { status: 'PENDING' };
    if (user.role !== UserRole.ADMIN) {
      where.targetTlId = user.id;
    }
    return this.prisma.vulnerabilityChangeRequest.findMany({
      where,
      include: {
        vulnerability: true,
        requestedBy: { select: { id: true, username: true, fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private assertCanReviewChangeRequest(cr: { targetTlId: string | null }, reviewer: { id: string; role: UserRole }) {
    if (reviewer.role === UserRole.ADMIN) return;
    if (cr.targetTlId && cr.targetTlId === reviewer.id) return;
    throw new ForbiddenException('You are not authorized to review this request');
  }

  async approveChangeRequest(id: string, reviewer: { id: string; role: UserRole }) {
    const cr = await this.prisma.vulnerabilityChangeRequest.findUnique({
      where: { id },
      include: { vulnerability: true },
    });
    if (!cr) throw new NotFoundException('Change request not found');
    if (cr.status !== 'PENDING') throw new BadRequestException('This request has already been reviewed');
    this.assertCanReviewChangeRequest(cr, reviewer);

    const updated = await this.prisma.vulnerability.update({
      where: { id: cr.vulnerabilityId },
      data: cr.afterData as any,
    });

    await this.prisma.vulnerabilityChangeRequest.update({
      where: { id },
      data: { status: 'APPROVED', reviewedById: reviewer.id, reviewedAt: new Date() },
    });

    await this.auditService.log({
      actorId: reviewer.id,
      action: 'VULNERABILITY_UPDATED',
      targetType: 'VULNERABILITY',
      targetId: cr.vulnerabilityId,
      ipAddress: 'unknown',
      userAgent: 'unknown',
      details: { before: cr.beforeData, after: cr.afterData, viaChangeRequest: id, requestedById: cr.requestedById },
    });

    await this.notificationsService.create({
      userId: cr.requestedById,
      type: NotificationType.VULNERABILITY_CHANGE_APPROVED,
      title: 'Vulnerability Edit Approved',
      message: `Your proposed edit to "${cr.vulnerability.name}" has been approved.`,
      relatedId: cr.vulnerabilityId,
    });

    return updated;
  }

  async rejectChangeRequest(id: string, reviewer: { id: string; role: UserRole }) {
    const cr = await this.prisma.vulnerabilityChangeRequest.findUnique({
      where: { id },
      include: { vulnerability: true },
    });
    if (!cr) throw new NotFoundException('Change request not found');
    if (cr.status !== 'PENDING') throw new BadRequestException('This request has already been reviewed');
    this.assertCanReviewChangeRequest(cr, reviewer);

    await this.prisma.vulnerabilityChangeRequest.update({
      where: { id },
      data: { status: 'REJECTED', reviewedById: reviewer.id, reviewedAt: new Date() },
    });

    await this.notificationsService.create({
      userId: cr.requestedById,
      type: NotificationType.VULNERABILITY_CHANGE_REJECTED,
      title: 'Vulnerability Edit Rejected',
      message: `Your proposed edit to "${cr.vulnerability.name}" was rejected. Original data retained.`,
      relatedId: cr.vulnerabilityId,
    });

    return { message: 'Change request rejected. Original data retained.' };
  }

  async update(id: string, data: any, actorId?: string) {
    const vuln = await this.prisma.vulnerability.findUnique({ where: { id } });
    if (!vuln) {
      throw new NotFoundException('Vulnerability not found');
    }

    const updated = await this.prisma.vulnerability.update({
      where: { id },
      data,
    });

    // Notify requester if this was a requested vulnerability
    if (vuln.requestedById) {
      await this.notificationsService.create({
        userId: vuln.requestedById,
        type: 'VULNERABILITY_EDITED',
        title: 'Vulnerability Updated',
        message: `"${vuln.name}" has been updated by an admin.`,
        relatedId: id,
      });
    }

    if (actorId) {
      await this.auditService.log({
        actorId,
        action: 'VULNERABILITY_UPDATED',
        targetType: 'VULNERABILITY',
        targetId: id,
        ipAddress: 'unknown',
        userAgent: 'unknown',
        details: {
          before: { severity: vuln.severity, status: vuln.status },
          after: { severity: updated.severity, status: updated.status },
        },
      });
    }

    return updated;
  }

  async remove(id: string, actorId?: string) {
    const vuln = await this.prisma.vulnerability.findUnique({ where: { id } });
    if (!vuln) {
      throw new NotFoundException('Vulnerability not found');
    }

    const removed = await this.prisma.vulnerability.update({
      where: { id },
      data: { isActive: false },
    });

    if (actorId) {
      await this.auditService.log({
        actorId,
        action: 'VULNERABILITY_DELETED',
        targetType: 'VULNERABILITY',
        targetId: id,
        ipAddress: 'unknown',
        userAgent: 'unknown',
        details: { name: vuln.name },
      });
    }

    return removed;
  }

  async getHistory(id: string) {
    return this.prisma.auditLog.findMany({
      where: { targetType: 'VULNERABILITY', targetId: id },
      orderBy: { timestamp: 'desc' },
      include: { actor: { select: { id: true, username: true } } },
    });
  }

  /** Admin-only feed of every vulnerability change across the system (not scoped to one record). */
  async getAllHistory(limit = 100) {
    const logs = await this.prisma.auditLog.findMany({
      where: { targetType: 'VULNERABILITY' },
      orderBy: { timestamp: 'desc' },
      take: limit,
      include: { actor: { select: { id: true, username: true } } },
    });

    const vulnIds = [...new Set(logs.map((l) => l.targetId).filter((id): id is string => !!id))];
    const vulns = await this.prisma.vulnerability.findMany({
      where: { id: { in: vulnIds } },
      select: { id: true, name: true },
    });
    const nameById = new Map(vulns.map((v) => [v.id, v.name]));

    return logs.map((log) => ({
      ...log,
      vulnerabilityName: log.targetId ? nameById.get(log.targetId) ?? '(deleted)' : null,
    }));
  }

  async request(data: {
    name: string;
    severity: string;
    cvssScore?: number;
    cvssVector?: string;
    description: string;
    impact: string;
    remediation: string;
    references: string;
    cveId?: string;
    cweId?: string;
    category?: string;
  }, requestedById: string) {
    const vuln = await this.createRequest(this.prisma, data, requestedById);
    await this.announceRequest(vuln, requestedById);
    return vuln;
  }

  /** The PENDING record of a vulnerability request. `db` lets a caller write it inside its own transaction. */
  createRequest(db: Pick<PrismaService, 'vulnerability'>, data: any, requestedById: string) {
    return db.vulnerability.create({
      data: {
        ...data,
        status: VulnerabilityStatus.PENDING,
        requestedById,
      } as any,
    });
  }

  /** Tells admins / TLs about a new request and records it in the audit log. */
  async announceRequest(vuln: { id: string; name: string; severity: string }, requestedById: string) {
    // Notify admins/TLs about the new request
    await this.notificationsService.notifyAdminsAndTLs({
      type: 'VULNERABILITY_REQUESTED',
      title: 'New Vulnerability Request',
      message: `"${vuln.name}" (${vuln.severity}) has been requested for approval.`,
      relatedId: vuln.id,
      excludeUserId: requestedById,
    });

    await this.auditService.log({
      actorId: requestedById,
      action: 'VULNERABILITY_REQUESTED',
      targetType: 'VULNERABILITY',
      targetId: vuln.id,
      ipAddress: 'unknown',
      userAgent: 'unknown',
      details: { name: vuln.name, severity: vuln.severity },
    });
  }

  async approve(id: string, reviewedById: string) {
    const vuln = await this.prisma.vulnerability.findUnique({ where: { id } });
    if (!vuln) {
      throw new NotFoundException('Vulnerability not found');
    }

    const updated = await this.prisma.vulnerability.update({
      where: { id },
      data: {
        status: VulnerabilityStatus.APPROVED,
        reviewedById,
        reviewedAt: new Date(),
      },
    });

    // Notify the requester
    if (vuln.requestedById && vuln.requestedById !== reviewedById) {
      await this.notificationsService.create({
        userId: vuln.requestedById,
        type: 'VULNERABILITY_APPROVED',
        title: 'Vulnerability Approved',
        message: `"${vuln.name}" has been approved.`,
        relatedId: id,
      });
    }

    await this.auditService.log({
      actorId: reviewedById,
      action: 'VULNERABILITY_APPROVED',
      targetType: 'VULNERABILITY',
      targetId: id,
      ipAddress: 'unknown',
      userAgent: 'unknown',
      details: { name: vuln.name },
    });

    return updated;
  }

  async reject(id: string, reviewedById: string) {
    const vuln = await this.prisma.vulnerability.findUnique({ where: { id } });
    if (!vuln) {
      throw new NotFoundException('Vulnerability not found');
    }

    const updated = await this.prisma.vulnerability.update({
      where: { id },
      data: {
        status: VulnerabilityStatus.REJECTED,
        reviewedById,
        reviewedAt: new Date(),
      },
    });

    // Notify the requester
    if (vuln.requestedById && vuln.requestedById !== reviewedById) {
      await this.notificationsService.create({
        userId: vuln.requestedById,
        type: 'VULNERABILITY_REJECTED',
        title: 'Vulnerability Rejected',
        message: `"${vuln.name}" has been rejected.`,
        relatedId: id,
      });
    }

    await this.auditService.log({
      actorId: reviewedById,
      action: 'VULNERABILITY_REJECTED',
      targetType: 'VULNERABILITY',
      targetId: id,
      ipAddress: 'unknown',
      userAgent: 'unknown',
      details: { name: vuln.name },
    });

    return updated;
  }

  async getSeverities() {
    const severities = await this.prisma.vulnerability.groupBy({
      by: ['severity'],
      _count: { severity: true },
    });
    return severities.map(s => s.severity);
  }

  async exportToCsv(severity?: string): Promise<string> {
    const where: any = { status: VulnerabilityStatus.APPROVED, isActive: true };
    if (severity) where.severity = severity;

    const vulns = await this.prisma.vulnerability.findMany({
      where,
      orderBy: [{ cvssScore: 'desc' }, { name: 'asc' }],
    });

    const headers = ['S.No', 'Name', 'Severity', 'CVSS', 'CVSS-VEC', 'Description', 'Impact', 'Remediation', 'References', 'CVE ID', 'CWE ID'];
    let csv = headers.join(',') + '\n';

    vulns.forEach((v, i) => {
      const row = [
        i + 1,
        this.escapeCsv(v.name),
        v.severity,
        v.cvssScore ?? '',
        this.escapeCsv(stripCvssPrefix(v.cvssVector)),
        this.escapeCsv(v.description),
        this.escapeCsv(v.impact),
        this.escapeCsv(v.remediation),
        this.escapeCsv(v.references),
        this.escapeCsv(v.cveId ?? ''),
        this.escapeCsv(v.cweId ?? ''),
      ];
      csv += row.join(',') + '\n';
    });

    return csv;
  }

  // ─── Bulk Upload ───

  readonly EXPECTED_HEADERS = ['S.No', 'Name', 'Severity', 'CVSS', 'CVSS-VEC', 'Description', 'Impact', 'Remediation', 'Reference', 'CVE ID', 'CWE ID'];

  getSampleCsv(): string {
    const headers = this.EXPECTED_HEADERS.join(',');
    const sampleRow = [
      '1',
      'SQL Injection',
      'High',
      '8.1',
      'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N',
      'SQL injection allows an attacker to interfere with the queries that an application makes to its database.',
      'An attacker can view, modify, or delete data in the database.',
      'Use parameterized queries (prepared statements). Validate and sanitize all user inputs.',
      'https://owasp.org/www-community/attacks/SQL_Injection',
      'CVE-2023-12345',
      'CWE-89',
    ].map(v => this.escapeCsv(v)).join(',');
    return `${headers}\n${sampleRow}\n`;
  }

  /**
   * REPLACE (default): the category's database is replaced by the file, as always.
   * MERGE: the category's current entries stay; the file's new names are added. A name that appears more than
   * once in the file, or that the category already has, is a conflict the admin resolves: `resolutions` maps the
   * name (trimmed, whitespace-collapsed, lower-cased) to the file row number to keep, or 0 to keep the existing
   * entry. Unresolved conflicts reject the upload, listing the competing versions, before anything is written.
   */
  async bulkUpload(csvContent: string, category: string, adminId: string, ipAddress: string, userAgent: string, resolutions: Record<string, number> = {}, mode: 'REPLACE' | 'MERGE' = 'REPLACE') {
    if (category !== 'APPLICATION_API' && category !== 'NETWORK') {
      throw new BadRequestException('category must be APPLICATION_API or NETWORK.');
    }
    if (mode !== 'REPLACE' && mode !== 'MERGE') {
      throw new BadRequestException('mode must be REPLACE or MERGE.');
    }

    const allRows = parseCsv(csvContent.trim());
    if (allRows.length < 2) {
      throw new BadRequestException('CSV file is empty or missing data rows.');
    }

    const headers = allRows[0].map(h => h.trim());

    // Validate headers by name before reading any data row — order doesn't
    // matter since `get()` below looks columns up by header name.
    validateExactCsvHeaders(headers, this.EXPECTED_HEADERS);
    const normalize = (h: string) => h.toLowerCase().replace(/\s+/g, '').replace(/[-_]/g, '');

    const rows: any[] = [];
    for (let i = 1; i < allRows.length; i++) {
      const cols = allRows[i];
      if (cols.length === 1 && cols[0].trim() === '') continue; // blank line

      if (cols.length > headers.length) {
        throw new BadRequestException(
          `Row ${i + 1} has ${cols.length} column(s) but the header row has ${headers.length}. Check for an unescaped comma or unquoted value in that row.`,
        );
      }
      // Excel/Sheets often drop trailing commas for empty trailing cells —
      // pad those back out rather than rejecting a row that's only short
      // at the end (e.g. blank CVE ID/CWE ID).
      while (cols.length < headers.length) cols.push('');
      // Map by header position
      const get = (expectedHeader: string) => {
        const idx = headers.findIndex(h => normalize(h) === normalize(expectedHeader));
        return idx >= 0 ? cols[idx]?.trim() : '';
      };

      const name = get('Name');
      const severity = get('Severity');
      const description = get('Description');
      const impact = get('Impact');
      const remediation = get('Remediation');
      const references = get('Reference');

      const requiredFields: [string, string][] = [
        ['Name', name], ['Severity', severity], ['Description', description],
        ['Impact', impact], ['Remediation', remediation], ['Reference', references],
      ];
      const emptyFields = requiredFields.filter(([, value]) => !value).map(([label]) => label);
      if (emptyFields.length > 0) {
        throw new BadRequestException(`Row ${i + 1} is missing required field(s): ${emptyFields.join(', ')}.`);
      }

      const cvssRaw = get('CVSS');
      const cvssScore = cvssRaw ? parseFloat(cvssRaw) : null;

      rows.push({
        sourceRow: i + 1,
        name,
        severity,
        cvssScore: cvssScore && !isNaN(cvssScore) ? cvssScore : null,
        cvssVector: get('CVSS-VEC') || null,
        description,
        impact,
        remediation,
        references,
        cveId: get('CVE ID') || null,
        cweId: get('CWE ID') || null,
        status: VulnerabilityStatus.APPROVED,
        isActive: true,
        category,
      });
    }

    if (rows.length === 0) {
      throw new BadRequestException('No valid data rows found in CSV.');
    }

    const stripRow = ({ sourceRow, ...data }: any) => data;
    const version = ({ sourceRow, id, severity, cvssScore, cvssVector, cveId, cweId, description, impact, remediation, references }: any) => ({
      row: sourceRow ?? null, severity, cvssScore, cvssVector, cveId, cweId, description, impact, remediation, references,
    });

    // REPLACE: the file replaces the whole category, as it always has.
    if (mode === 'REPLACE') {
      await this.prisma.$transaction(async (tx) => {
        await tx.vulnerability.updateMany({ where: { category: category as any }, data: { isActive: false } });
        await tx.vulnerability.createMany({ data: rows.map(stripRow) });
      });
      await this.auditService.log({
        actorId: adminId,
        action: 'ADMIN_OVERRIDE',
        targetType: 'VULNERABILITY',
        ipAddress,
        userAgent,
        details: { action: 'bulk_upload', mode, count: rows.length, category },
      });
      return {
        message: `Successfully uploaded ${rows.length} vulnerabilities. The existing ${category.replace('_', '/')} database has been replaced.`,
        count: rows.length,
      };
    }

    // MERGE: current entries stay. A name repeated in the file, or already in this category, is a conflict
    // the admin resolves (a file row number to keep, or 0 to keep the existing entry).
    const outcome = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.vulnerability.findMany({ where: { category: category as any, isActive: true } });
      const existingByKey = new Map<string, any[]>();
      for (const e of existing) existingByKey.set(normalizeVulnName(e.name), [...(existingByKey.get(normalizeVulnName(e.name)) ?? []), e]);
      const groups = new Map<string, any[]>();
      for (const r of rows) groups.set(normalizeVulnName(r.name), [...(groups.get(normalizeVulnName(r.name)) ?? []), r]);

      const valid = (key: string, g: any[]) => g.some((r) => r.sourceRow === resolutions[key]) || (resolutions[key] === 0 && existingByKey.has(key));
      const conflicts = [...groups.entries()].filter(([key, g]) => (g.length > 1 || existingByKey.has(key)) && !valid(key, g));
      if (conflicts.length > 0) {
        throw new BadRequestException({
          message: `${conflicts.length} vulnerability name${conflicts.length === 1 ? ' appears' : 's appear'} more than once (in the file or already in the database). Choose which version to keep for each; nothing has been uploaded.`,
          duplicates: conflicts.map(([key, g]) => ({
            key,
            name: g[0].name,
            existing: (existingByKey.get(key) ?? []).slice(0, 1).map(version)[0] ?? null,
            rows: g.map(version),
          })),
        });
      }

      const toInsert: any[] = [];
      const toDeactivate: string[] = [];
      let skipped = 0;
      for (const [key, g] of groups) {
        const hasExisting = existingByKey.has(key);
        if (g.length === 1 && !hasExisting) { toInsert.push(g[0]); continue; }
        const pick = g.find((r) => r.sourceRow === resolutions[key]);
        skipped += g.length - (pick ? 1 : 0);
        if (pick) {
          toInsert.push(pick);
          (existingByKey.get(key) ?? []).forEach((e) => toDeactivate.push(e.id));
        }
      }
      if (toDeactivate.length) await tx.vulnerability.updateMany({ where: { id: { in: toDeactivate } }, data: { isActive: false } });
      if (toInsert.length) await tx.vulnerability.createMany({ data: toInsert.map(stripRow) });
      return { added: toInsert.length - new Set(toDeactivate).size, replaced: new Set(toDeactivate).size, skipped, total: toInsert.length };
    });

    await this.auditService.log({
      actorId: adminId,
      action: 'ADMIN_OVERRIDE',
      targetType: 'VULNERABILITY',
      ipAddress,
      userAgent,
      details: { action: 'bulk_upload', mode, category, ...outcome },
    });

    return {
      message: `Merged into the ${category.replace('_', '/')} database: ${outcome.added} added, ${outcome.replaced} replaced, ${outcome.skipped} row${outcome.skipped === 1 ? '' : 's'} left out. Other existing entries were kept.`,
      count: outcome.total,
    };
  }

  private escapeCsv(value: string): string {
    if (!value) return '';
    // Neutralize CSV/formula injection — a leading =, +, -, @, tab, or CR is
    // interpreted as a formula by Excel/Sheets when the file is reopened.
    if (/^[=+\-@\t\r]/.test(value)) value = `'${value}`;
    const needsQuotes = /[",\n]/.test(value);
    const escaped = value.replace(/"/g, '""');
    return needsQuotes ? `"${escaped}"` : escaped;
  }
}
