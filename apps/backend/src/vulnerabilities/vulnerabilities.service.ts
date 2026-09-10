import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { UserRole, VulnerabilityStatus, NotificationType } from '@prisma/client';

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
    const vuln = await this.prisma.vulnerability.create({
      data: {
        ...data,
        status: VulnerabilityStatus.PENDING,
        requestedById,
      } as any,
    });

    // Notify admins/TLs about the new request
    await this.notificationsService.notifyAdminsAndTLs({
      type: 'VULNERABILITY_REQUESTED',
      title: 'New Vulnerability Request',
      message: `"${data.name}" (${data.severity}) has been requested for approval.`,
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

    return vuln;
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
        this.escapeCsv(v.cvssVector ?? ''),
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

  private readonly EXPECTED_HEADERS = ['S.No', 'Name', 'Severity', 'CVSS', 'CVSS-VEC', 'Description', 'Impact', 'Remediation', 'Reference', 'CVE ID', 'CWE ID'];

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

  async bulkUpload(csvContent: string, category: string, adminId: string, ipAddress: string, userAgent: string) {
    if (category !== 'APPLICATION_API' && category !== 'NETWORK') {
      throw new BadRequestException('category must be APPLICATION_API or NETWORK.');
    }

    const lines = csvContent.trim().split(/\r?\n/);
    if (lines.length < 2) {
      throw new BadRequestException('CSV file is empty or missing data rows.');
    }

    const headerLine = lines[0].trim();
    const headers = this.parseCsvLine(headerLine).map(h => h.trim());

    // Normalize headers for comparison (case-insensitive, handle spaces)
    const normalize = (h: string) => h.toLowerCase().replace(/\s+/g, '').replace(/[-_]/g, '');
    const expectedNormalized = this.EXPECTED_HEADERS.map(normalize);
    const actualNormalized = headers.map(normalize);

    const missing = expectedNormalized.filter((h, i) => actualNormalized[i] !== h);
    if (missing.length > 0 || actualNormalized.length < expectedNormalized.length) {
      throw new BadRequestException(
        `Invalid CSV format. Missing or incorrect headers. Expected: ${this.EXPECTED_HEADERS.join(', ')}`,
      );
    }

    const rows: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = this.parseCsvLine(line);
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

      if (!name || !severity || !description || !impact || !remediation || !references) {
        throw new BadRequestException(`Row ${i + 1} is missing required fields (Name, Severity, Description, Impact, Remediation, Reference).`);
      }

      const cvssRaw = get('CVSS');
      const cvssScore = cvssRaw ? parseFloat(cvssRaw) : null;

      rows.push({
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

    // Transaction: soft-delete existing entries IN THIS CATEGORY ONLY, then
    // insert the new ones — scoping this to `category` is what keeps an
    // upload of one category from wiping out the other's data.
    await this.prisma.$transaction(async (tx) => {
      await tx.vulnerability.updateMany({
        where: { category: category as any },
        data: { isActive: false },
      });
      await tx.vulnerability.createMany({
        data: rows,
      });
    });

    // Audit log
    await this.auditService.log({
      actorId: adminId,
      action: 'ADMIN_OVERRIDE',
      targetType: 'VULNERABILITY',
      ipAddress,
      userAgent,
      details: { action: 'bulk_upload', count: rows.length, category },
    });

    return { message: `Successfully uploaded ${rows.length} vulnerabilities. The existing ${category.replace('_', '/')} database has been replaced.`, count: rows.length };
  }

  // Simple CSV line parser handling quoted values
  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  }

  private escapeCsv(value: string): string {
    if (!value) return '';
    const needsQuotes = /[",\n]/.test(value);
    const escaped = value.replace(/"/g, '""');
    return needsQuotes ? `"${escaped}"` : escaped;
  }
}
