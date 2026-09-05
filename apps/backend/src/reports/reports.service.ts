import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from './storage.service';
import { DocxManipulatorService, FieldRule, FindingData, PocImage } from './docx-manipulator.service';
import { AuditService } from '../audit/audit.service';
import { User, UserRole, TemplateCategory, TemplateSubType, ProjectStatus } from '@prisma/client';
import * as crypto from 'crypto';

const SUB_TYPE_FILE_LABELS: Record<TemplateSubType, string> = {
  WEB: 'Web',
  API: 'API',
  MOBILE: 'Mobile',
  THICK_CLIENT: 'Thick-Client',
};

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private docxManipulator: DocxManipulatorService,
    private configService: ConfigService,
    private auditService: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Template Management
  // ---------------------------------------------------------------------------

  async uploadTemplate(
    file: Express.Multer.File,
    name: string,
    category: TemplateCategory,
    subType: TemplateSubType,
    effectiveFrom: Date,
    effectiveTo: Date | null,
    adminId: string,
    ipAddress: string,
    userAgent: string,
  ) {
    if (!file.originalname.endsWith('.docx')) {
      throw new BadRequestException('Only .docx templates are allowed');
    }

    const fileHash = crypto.createHash('sha256').update(file.buffer).digest('hex');

    // Structural validation: fields + mandatory tables + dry-run generation
    this.logger.log(`Analyzing template: ${name}`);
    const analysis = await this.docxManipulator.analyzeTemplate(file.buffer);
    this.logger.log(`Found ${analysis.fields.length} unique fields`);

    let dryRunOk = false;
    let dryRunError: string | null = null;
    try {
      await this.docxManipulator.generateReport(
        file.buffer,
        [{ match: ['client_name'], value: 'Dry Run Client' }],
        [this.sampleFinding()],
      );
      dryRunOk = true;
    } catch (error: any) {
      dryRunError = error?.message || 'Dry-run generation failed';
      this.logger.warn(`Template dry-run failed for ${name}: ${dryRunError}`);
    }

    // Diff against the currently active version of the same category + subType
    const previousActive = await this.prisma.reportTemplate.findFirst({
      where: { category, subType, isActive: true },
      include: { fields: true },
      orderBy: { effectiveFrom: 'desc' },
    });
    const newFieldNames = new Set(analysis.fields.map((f) => f.normalizedName));
    const oldFieldNames = new Set((previousActive?.fields || []).map((f) => f.normalizedName));
    const fieldDiff = {
      added: [...newFieldNames].filter((f) => !oldFieldNames.has(f)),
      removed: [...oldFieldNames].filter((f) => !newFieldNames.has(f)),
      comparedTo: previousActive ? previousActive.name : null,
    };

    const objectName = `templates/${category}/${subType}/${Date.now()}_${file.originalname}`;
    await this.storage.uploadFile(objectName, file.buffer, file.mimetype);

    // Uploads are created as INACTIVE drafts — activation is a separate,
    // explicit step after the admin reviews the validation report.
    const template = await this.prisma.reportTemplate.create({
      data: {
        name,
        filePath: objectName,
        fileHash,
        category,
        subType,
        projectType: `${category}_${subType}`,
        effectiveFrom,
        effectiveTo,
        isActive: false,
        uploadedById: adminId,
        fields: {
          create: analysis.fields.map((field, index) => ({
            name: field.name,
            normalizedName: field.normalizedName,
            category: field.category.toUpperCase() as any,
            description: field.description,
            isRepeatable: field.isRepeatable,
            sortOrder: index,
          })),
        },
      },
      include: { fields: true },
    });

    await this.auditService.log({
      actorId: adminId,
      action: 'TEMPLATE_UPLOADED',
      targetType: 'TEMPLATE',
      targetId: template.id,
      ipAddress,
      userAgent,
      details: {
        name, category, subType,
        fieldCount: analysis.fields.length,
        dryRunOk,
        missingMandatory: analysis.missingMandatory,
      },
    });

    return {
      ...template,
      validation: {
        fieldCount: analysis.fields.length,
        hasSummaryTable: analysis.hasSummaryTable,
        hasDetailedTable: analysis.hasDetailedTable,
        missingMandatory: analysis.missingMandatory,
        warnings: analysis.warnings,
        dryRunOk,
        dryRunError,
        fieldDiff,
        canActivate: dryRunOk && analysis.missingMandatory.length === 0,
      },
    };
  }

  async getTemplates(category?: TemplateCategory, subType?: TemplateSubType, includeInactive = false) {
    const where: any = {};
    if (!includeInactive) where.isActive = true;
    if (category) where.category = category;
    if (subType) where.subType = subType;

    return this.prisma.reportTemplate.findMany({
      where,
      include: {
        uploadedBy: {
          select: { id: true, username: true },
        },
        fields: {
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: [{ isActive: 'desc' }, { effectiveFrom: 'desc' }],
    });
  }

  async getTemplateFields(templateId: string) {
    const template = await this.prisma.reportTemplate.findUnique({
      where: { id: templateId },
      include: {
        fields: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!template) {
      throw new NotFoundException('Template not found');
    }

    return template.fields;
  }

  async activateTemplate(id: string, adminId: string, ipAddress: string, userAgent: string) {
    const template = await this.prisma.reportTemplate.findUnique({ where: { id } });
    if (!template) {
      throw new NotFoundException('Template not found');
    }

    // Versioning: deactivate other versions of the same category + subType.
    // Their files and records are kept, so old projects still regenerate correctly.
    await this.prisma.reportTemplate.updateMany({
      where: {
        category: template.category,
        subType: template.subType,
        isActive: true,
        id: { not: id },
      },
      data: { isActive: false, effectiveTo: new Date() },
    });

    const activated = await this.prisma.reportTemplate.update({
      where: { id },
      data: { isActive: true },
    });

    await this.auditService.log({
      actorId: adminId,
      action: 'TEMPLATE_ACTIVATED',
      targetType: 'TEMPLATE',
      targetId: id,
      ipAddress,
      userAgent,
    });

    return activated;
  }

  async deactivateTemplate(id: string, adminId: string, ipAddress: string, userAgent: string) {
    const template = await this.prisma.reportTemplate.update({
      where: { id },
      data: { isActive: false, effectiveTo: new Date() },
    });

    await this.auditService.log({
      actorId: adminId,
      action: 'TEMPLATE_DEACTIVATED',
      targetType: 'TEMPLATE',
      targetId: id,
      ipAddress,
      userAgent,
    });

    return template;
  }

  // ---------------------------------------------------------------------------
  // Pre-generation completeness check
  // ---------------------------------------------------------------------------

  async preflight(projectId: string, user: User) {
    const project = await this.loadProjectForReport(projectId, user);
    const missing: { field: string; label: string; source: string }[] = [];

    const projectFields: { key: string; label: string }[] = [
      { key: 'appVersion', label: 'App Version' },
      { key: 'location', label: 'Location' },
      { key: 'documentVersion', label: 'Document Version' },
      { key: 'toolsUsed', label: 'Tools Used' },
      { key: 'testingEnvironment', label: 'Testing Environment' },
      { key: 'qaReviewerName', label: 'QA Reviewer Name' },
      { key: 'applicationDetails', label: 'Application Details' },
      { key: 'testingType', label: 'Testing Type' },
      { key: 'loginSystemTypes', label: 'Types of Login System' },
      { key: 'applicationNature', label: 'Nature of the Application' },
    ];
    for (const { key, label } of projectFields) {
      if (!(project as any)[key]) {
        missing.push({ field: key, label, source: 'Project details' });
      }
    }

    if (!project.tester.fullName) {
      missing.push({ field: 'testerFullName', label: 'Tester full name', source: 'Tester profile' });
    }
    if (!project.tl.fullName) {
      missing.push({ field: 'tlFullName', label: 'Team Lead full name', source: 'TL profile' });
    }
    const avp = (project.tl as any).manager;
    if (!avp) {
      missing.push({ field: 'avp', label: 'AVP (TL manager) assignment', source: 'User Management' });
    } else {
      if (!avp.fullName) missing.push({ field: 'avpFullName', label: 'AVP full name', source: 'AVP profile' });
      if (!avp.phone) missing.push({ field: 'avpPhone', label: 'AVP contact number', source: 'AVP profile' });
    }

    if (!project.template) {
      missing.push({ field: 'template', label: 'Report template', source: 'Template management' });
    }

    const approvedFindings = project.findings.length;
    if (approvedFindings === 0) {
      missing.push({ field: 'findings', label: 'At least one approved finding', source: 'Project findings' });
    }

    return {
      ready: missing.length === 0,
      missing,
      approvedFindings,
      templateName: project.template?.name || null,
      suggestedFileName: this.buildReportFileName(project),
    };
  }

  // ---------------------------------------------------------------------------
  // Report Generation
  // ---------------------------------------------------------------------------

  async generateReport(
    projectId: string,
    user: User,
    ipAddress: string,
    userAgent: string,
  ) {
    const project = await this.loadProjectForReport(projectId, user);

    // Resolve template: project-pinned version, else the active version for its type
    let template = project.template;
    if (!template) {
      template = await this.prisma.reportTemplate.findFirst({
        where: { isActive: true, category: project.category, subType: project.subType },
        orderBy: { effectiveFrom: 'desc' },
      });
    }
    if (!template) {
      throw new BadRequestException(
        `No active template found for ${project.category} / ${project.subType}`,
      );
    }

    const templateBuffer = await this.storage.getFile(template.filePath);

    // Build field rules automatically from project + profiles (no manual form)
    const rules = this.buildFieldRules(project);

    // Findings: approved only, sorted by effective CVSS descending
    const sortedFindings = project.findings
      .map((f) => ({
        ...f,
        effectiveScore: f.cvssScoreOverride ?? f.vulnerability.cvssScore ?? 0,
      }))
      .sort((a, b) => b.effectiveScore - a.effectiveScore);

    // Collect POC images from storage
    const images: PocImage[] = [];
    const findingsData: FindingData[] = [];
    for (let index = 0; index < sortedFindings.length; index++) {
      const f = sortedFindings[index];
      const effectiveScore = f.cvssScoreOverride ?? f.vulnerability.cvssScore;

      const pocSteps = [] as FindingData['pocSteps'];
      for (const step of f.pocSteps || []) {
        let imageKey: string | null = null;
        if (step.imagePath) {
          try {
            const buffer = await this.storage.getFile(step.imagePath);
            imageKey = `finding_${f.id}_step_${step.stepNo}`;
            const ext = (step.imagePath.split('.').pop() || 'png').toLowerCase();
            images.push({ key: imageKey, buffer, extension: ext === 'jpeg' ? 'jpg' : ext });
          } catch (error) {
            this.logger.warn(`POC image not found in storage: ${step.imagePath}`);
          }
        }
        pocSteps.push({ stepNo: step.stepNo, description: step.description, imageKey });
      }

      findingsData.push({
        no: index + 1,
        title: f.vulnerability.name,
        severity: f.cvssScoreOverride != null
          ? this.severityFromScore(f.cvssScoreOverride)
          : f.vulnerability.severity,
        cvssScore: effectiveScore,
        cvssVector: f.cvssVectorOverride ?? f.vulnerability.cvssVector,
        description: f.vulnerability.description,
        impact: f.vulnerability.impact,
        remediation: f.vulnerability.remediation,
        references: f.vulnerability.references,
        cveId: f.vulnerability.cveId,
        cweId: f.vulnerability.cweId,
        affectedInstances: (f.affectedInstances || []).join('\n'),
        authenticationType: f.authenticationType,
        vulnerabilityDependency: f.vulnerabilityDependency,
        reportStatus: f.reportStatus,
        pocSteps,
      });
    }

    this.logger.log(`Generating report for project ${projectId} using template ${template.name}`);
    const reportBuffer = await this.docxManipulator.generateReport(
      templateBuffer,
      rules,
      findingsData,
      images,
      this.buildContacts(project),
    );

    // File naming convention: App-Security-Test_{Client}-{App}_{SubType}_v{DocVersion}_{YYYY-MM-DD}_Non-Compliant.docx
    const fileName = this.buildReportFileName(project, template);
    const docxName = `reports/${projectId}/${Date.now()}_${fileName}`;
    await this.storage.uploadFile(
      docxName,
      reportBuffer,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );

    // Snapshot of the auto-filled data, for audit
    const fieldDataSnapshot = Object.fromEntries(
      rules.map((r) => [r.match[0], r.value]),
    );

    await this.prisma.reportGeneration.create({
      data: {
        projectId,
        templateId: template.id,
        generatedById: user.id,
        fieldData: fieldDataSnapshot,
        docxPath: docxName,
        pdfPath: null,
        isDraft: true,
      },
    });

    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        reportDocxPath: docxName,
        reportPdfPath: null,
        generatedAt: new Date(),
        status: ProjectStatus.COMPLETED,
      },
    });

    await this.auditService.log({
      actorId: user.id,
      action: 'REPORT_GENERATED',
      targetType: 'PROJECT',
      targetId: projectId,
      ipAddress,
      userAgent,
      details: { templateId: template.id, format: 'docx', fileName },
    });

    return {
      fileName,
      docxUrl: await this.storage.getPresignedUrl(docxName, 3600),
      isDraft: true,
      findingsCount: findingsData.length,
    };
  }

  async getReportHistory(projectId: string, user: User) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    if (user.role === UserRole.TESTER && project.testerId !== user.id) {
      throw new NotFoundException('Project not found');
    }

    const history = await this.prisma.reportGeneration.findMany({
      where: { projectId },
      include: {
        template: {
          select: { id: true, name: true, category: true, subType: true },
        },
        generatedBy: {
          select: { id: true, username: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Attach presigned download URLs
    return Promise.all(
      history.map(async (h) => ({
        ...h,
        fileName: h.docxPath ? h.docxPath.split('/').pop()?.replace(/^\d+_/, '') : null,
        docxUrl: h.docxPath ? await this.storage.getPresignedUrl(h.docxPath, 3600) : null,
      })),
    );
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async loadProjectForReport(projectId: string, user: User) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        template: true,
        tester: true,
        tl: { include: { manager: true } },
        findings: {
          where: { status: 'APPROVED' },
          include: {
            vulnerability: true,
            pocSteps: { orderBy: { stepNo: 'asc' } },
          },
        },
      },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    if (user.role === UserRole.TESTER && project.testerId !== user.id) {
      throw new NotFoundException('Project not found');
    }

    return project;
  }

  private buildContacts(project: any) {
    const person = (u: any) => ({
      fullName: u?.fullName || u?.username || '',
      designation: u?.designation || '',
      phone: u?.phone || '',
      email: u?.email || '',
    });
    return {
      avp: person(project.tl?.manager),
      tl: person(project.tl),
      tester: person(project.tester),
    };
  }

  /**
   * Ordered field rules. First matching rule wins, so specific patterns
   * come before generic ones. Per-person contact fields (phone/email/title)
   * are NOT here — they are filled row-aware by the contact-table pass.
   */
  private buildFieldRules(project: any): FieldRule[] {
    const tl = project.tl;
    const tester = project.tester;

    const appLabel = project.subType === 'API' ? 'API' : 'Application';
    const appNameVersion = [project.name, project.appVersion].filter(Boolean).join(' ');

    return [
      {
        // Merged run containing both dates, e.g. "Start Date {…}, to End Date {…}"
        match: ['start_date', 'end_date'],
        requireAll: true,
        value: `Start Date ${this.formatReportDate(project.startDate)}, to End Date ${this.formatReportDate(project.endDate)}`,
      },
      { match: ['start_date'], value: this.formatReportDate(project.startDate) },
      { match: ['end_date'], value: this.formatReportDate(project.endDate) },
      { match: ['qa_reviewer_name'], value: project.qaReviewerName || 'N/A' },
      { match: ['team_lead_name'], value: tl?.fullName || tl?.username || '' },
      { match: ['tester_name'], value: tester?.fullName || tester?.username || '' },
      { match: ['app_version'], value: appNameVersion || `${appLabel} Name` },
      { match: ['version_ex'], value: project.documentVersion || '1.0' },
      { match: ['client_name_location'], value: [project.clientName, project.location].filter(Boolean).join(', ') },
      { match: ['client_name'], value: project.clientName || '' },
      { match: ['month_dd_yyyy'], value: this.formatReportDate(new Date()) },
      { match: ['tools_name', 'tools_used'], value: project.toolsUsed || '' },
      { match: ['details_scope'], value: [project.applicationDetails, project.scope].filter(Boolean).join('\n') },
      { match: ['scope'], value: project.scope || '' },
      { match: ['staging_uat', 'testing_environment'], value: project.testingEnvironment || '' },
      { match: ['black_box', 'grey_box'], value: project.testingType || '' },
      { match: ['login_role_types'], value: project.loginSystemTypes || '' },
      { match: ['nature_or_purpose'], value: project.applicationNature || '' },
      { match: ['testing_limitation'], value: project.testingLimitation || 'N/A' },
      { match: ['build_details'], value: project.applicationDetails || '' },
    ];
  }

  private buildReportFileName(project: any, template?: any): string {
    const subTypeLabel = SUB_TYPE_FILE_LABELS[(template?.subType ?? project.subType) as TemplateSubType] || 'Web';
    const safe = (s: string) =>
      (s || '')
        .trim()
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'NA';
    const date = new Date().toISOString().split('T')[0];
    const docVersion = safe(project.documentVersion || '1.0');
    return `App-Security-Test_${safe(project.clientName)}-${safe(project.name)}_${subTypeLabel}_v${docVersion}_${date}_Non-Compliant.docx`;
  }

  private formatReportDate(date: Date | string | null | undefined): string {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: '2-digit' });
  }

  private severityFromScore(score: number): string {
    if (score >= 9.0) return 'Critical';
    if (score >= 7.0) return 'High';
    if (score >= 4.0) return 'Medium';
    if (score >= 0.1) return 'Low';
    return 'Info';
  }

  private sampleFinding(): FindingData {
    return {
      no: 1,
      title: 'Sample Vulnerability',
      severity: 'High',
      cvssScore: 7.5,
      cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N',
      description: 'Sample description for dry-run validation.',
      impact: 'Sample impact.',
      remediation: 'Sample remediation.',
      references: 'https://example.com',
      cveId: 'CVE-0000-0000',
      cweId: 'CWE-000',
      affectedInstances: 'https://example.com/endpoint',
      authenticationType: 'Form-based',
      vulnerabilityDependency: 'N/A',
      reportStatus: 'Open',
      pocSteps: [{ stepNo: 1, description: 'Sample POC step.', imageKey: null }],
    };
  }
}
