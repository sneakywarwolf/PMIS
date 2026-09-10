import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from './storage.service';
import { DocxManipulatorService, FieldRule, FindingData, PocImage } from './docx-manipulator.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { User, UserRole, TemplateCategory, TemplateSubType, ProjectStatus, ReportGenerationStatus } from '@prisma/client';
import * as crypto from 'crypto';
import { REPORT_GENERATION_QUEUE, ReportGenerationJobData } from './report-generation.types';
import { getPocReadiness, isFindingReportReady } from '../common/poc-validation.util';
import { CANONICAL_TEMPLATE_PARAMETERS, CANONICAL_PARAMETER_KEYS, resolveTemplateParameter } from './template-parameters';

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
    @Inject(forwardRef(() => SettingsService)) private settingsService: SettingsService,
    @InjectQueue(REPORT_GENERATION_QUEUE) private reportQueue: Queue<ReportGenerationJobData>,
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

  /**
   * Names already consumed by buildFieldRules()'s hardcoded project-field matching.
   * A custom field must never collide with these or generation would silently
   * double-fill or misfill a placeholder.
   */
  private static readonly CANONICAL_FIELD_NAMES = [
    'start_date', 'end_date', 'qa_reviewer_name', 'team_lead_name', 'tester_name',
    'app_version', 'version_ex', 'client_name_location', 'client_name', 'month_dd_yyyy',
    'tools_name', 'tools_used', 'details_scope', 'scope', 'staging_uat',
    'testing_environment', 'black_box', 'grey_box', 'login_role_types',
    'nature_or_purpose', 'testing_limitation', 'build_details',
  ];

  /** Slug: lowercase, spaces/dashes → underscore, strip anything else. */
  private slugifyFieldName(raw: string): string {
    return raw
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
      .replace(/[^a-z0-9_]/g, '');
  }

  /**
   * Placeholder matching is substring-based (see docx-manipulator's
   * `normalized.includes(m)`), so a collision isn't just exact-equality —
   * one name containing the other would also misfire at generation time.
   */
  private async assertFieldNameAvailable(templateId: string, normalizedName: string, excludeFieldId?: string) {
    if (!normalizedName) {
      throw new BadRequestException('Field name cannot be empty');
    }
    if (!/^[a-z0-9_]+$/.test(normalizedName)) {
      throw new BadRequestException('Field name must be lowercase letters, numbers, and underscores only');
    }

    const collidesWith = (other: string) => normalizedName.includes(other) || other.includes(normalizedName);

    if (ReportsService.CANONICAL_FIELD_NAMES.some(collidesWith)) {
      throw new BadRequestException(`"${normalizedName}" is reserved by the report engine and cannot be reused`);
    }

    const existingFields = await this.prisma.templateField.findMany({
      where: { templateId, ...(excludeFieldId ? { id: { not: excludeFieldId } } : {}) },
      select: { normalizedName: true },
    });
    if (existingFields.some((f) => collidesWith(f.normalizedName))) {
      throw new BadRequestException(`"${normalizedName}" already exists on this template`);
    }
  }

  async addTemplateField(
    templateId: string,
    data: { name: string; normalizedName: string; category: string; description?: string },
    adminId: string,
  ) {
    const template = await this.prisma.reportTemplate.findUnique({ where: { id: templateId } });
    if (!template) {
      throw new NotFoundException('Template not found');
    }

    const normalizedName = this.slugifyFieldName(data.normalizedName);
    await this.assertFieldNameAvailable(templateId, normalizedName);

    const maxSort = await this.prisma.templateField.aggregate({
      where: { templateId },
      _max: { sortOrder: true },
    });

    const field = await this.prisma.templateField.create({
      data: {
        templateId,
        name: data.name,
        normalizedName,
        category: data.category as any,
        description: data.description,
        isCustom: true,
        sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
      },
    });

    await this.auditService.log({
      actorId: adminId,
      action: 'TEMPLATE_FIELD_ADDED',
      targetType: 'TEMPLATE',
      targetId: templateId,
      ipAddress: 'unknown',
      userAgent: 'unknown',
      details: { fieldName: normalizedName },
    });

    return field;
  }

  async updateTemplateField(
    fieldId: string,
    data: { name?: string; category?: string; description?: string; mappedParameter?: string | null },
  ) {
    const field = await this.prisma.templateField.findUnique({ where: { id: fieldId } });
    if (!field) {
      throw new NotFoundException('Field not found');
    }
    if (data.mappedParameter && !CANONICAL_PARAMETER_KEYS.has(data.mappedParameter)) {
      throw new BadRequestException(`Unknown application parameter: ${data.mappedParameter}`);
    }

    return this.prisma.templateField.update({
      where: { id: fieldId },
      data: {
        ...(data.name ? { name: data.name } : {}),
        ...(data.category ? { category: data.category as any } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.mappedParameter !== undefined ? { mappedParameter: data.mappedParameter } : {}),
      },
    });
  }

  /** Canonical application parameters the admin can map a template field to. */
  getTemplateParameters() {
    return CANONICAL_TEMPLATE_PARAMETERS;
  }

  async activateTemplate(id: string, adminId: string, ipAddress: string, userAgent: string) {
    const template = await this.prisma.reportTemplate.findUnique({ where: { id } });
    if (!template) {
      throw new NotFoundException('Template not found');
    }

    // Activating a template replaces whatever was active for the same
    // category + subType — the old one is deleted outright (file + row +
    // its field mappings), not just deactivated. Existing ReportGeneration
    // rows and Project.templateId pointers are FK-SetNull, so already
    // generated reports and their stored docx/pdf files are never touched;
    // projects that had pinned the deleted template fall back to whichever
    // template is active for their category/subType at their next generation.
    const replaced = await this.prisma.reportTemplate.findMany({
      where: {
        category: template.category,
        subType: template.subType,
        isActive: true,
        id: { not: id },
      },
    });
    for (const old of replaced) {
      await this.storage.deleteFile(old.filePath).catch((err) =>
        this.logger.warn(`Failed to delete replaced template file ${old.filePath}: ${err?.message}`),
      );
      await this.prisma.reportTemplate.delete({ where: { id: old.id } });
    }

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
    } else {
      const { unresolved } = this.resolveMappedFields(project.template, project);
      for (const u of unresolved) {
        missing.push({
          field: `mapped:${u.parameter}`,
          label: `${u.field} (mapped to ${u.parameter}, but no value found)`,
          source: 'Template Mapping',
        });
      }
    }

    const approvedFindings = project.findings.length;
    if (approvedFindings === 0) {
      missing.push({ field: 'findings', label: 'At least one finding', source: 'Project findings' });
    }

    for (const finding of project.findings) {
      const vulnName = finding.vulnerability?.name || finding.id;
      const readiness = getPocReadiness(finding.pocSteps);
      if (readiness === 'both_missing') {
        missing.push({ field: 'pocStepsAndScreenshot', label: 'Steps & PoC Missing', source: `Finding: ${vulnName}` });
      } else if (readiness === 'steps_missing') {
        missing.push({ field: 'pocSteps', label: 'Steps Missing', source: `Finding: ${vulnName}` });
      } else if (readiness === 'poc_missing') {
        missing.push({ field: 'pocScreenshot', label: 'PoC Missing', source: `Finding: ${vulnName}` });
      }
    }
    const pocGateBlocked = project.findings.some((f) => getPocReadiness(f.pocSteps) !== 'ready');

    const nextVersion = await this.getNextReportVersion(projectId);

    return {
      ready: missing.length === 0,
      missing,
      approvedFindings,
      pocGateBlocked,
      templateName: project.template?.name || null,
      nextVersion,
      suggestedFileName: this.buildReportFileName(project, nextVersion),
    };
  }

  // ---------------------------------------------------------------------------
  // Report Generation
  // ---------------------------------------------------------------------------

  /**
   * Fast path, runs on the HTTP request: validation + template resolution
   * only (cheap DB reads). Creates a PENDING ReportGeneration row and hands
   * the CPU-heavy work (docx build, image collection, upload) to a
   * background queue via processReportGeneration(), so one user's report
   * doesn't block the event loop for everyone else generating concurrently.
   */
  async generateReport(
    projectId: string,
    user: User,
    ipAddress: string,
    userAgent: string,
  ) {
    const project = await this.loadProjectForReport(projectId, user);

    const pocGateBlocked = project.findings.some((f) => !isFindingReportReady(f.pocSteps));
    if (pocGateBlocked) {
      throw new BadRequestException('Report Generation not allowed until Steps and PoC screenshots/attachments are added.');
    }

    let template = project.template;
    if (!template) {
      template = await this.prisma.reportTemplate.findFirst({
        where: { isActive: true, category: project.category, subType: project.subType },
        orderBy: { effectiveFrom: 'desc' },
        include: { fields: true },
      });
    }
    if (!template) {
      throw new BadRequestException(
        `No active template found for ${project.category} / ${project.subType}`,
      );
    }

    const rules = this.buildFieldRules(project);
    rules.push(...this.buildCustomFieldRules(project));
    const fieldDataSnapshot = Object.fromEntries(rules.map((r) => [r.match[0], r.value]));

    // Version auto-increments per project: first generation is 1.0, every
    // subsequent generation is 1.1, 1.2, ... and never resets.
    const version = await this.getNextReportVersion(projectId);

    const reportGeneration = await this.prisma.reportGeneration.create({
      data: {
        projectId,
        templateId: template.id,
        generatedById: user.id,
        fieldData: fieldDataSnapshot,
        version,
        status: ReportGenerationStatus.PENDING,
        isDraft: true,
      },
    });

    await this.reportQueue.add('generate', {
      reportGenerationId: reportGeneration.id,
      actorId: user.id,
      ipAddress,
      userAgent,
    });

    this.logger.log(`Queued report generation ${reportGeneration.id} for project ${projectId}`);

    return {
      reportId: reportGeneration.id,
      status: ReportGenerationStatus.PENDING,
      version,
    };
  }

  /** Poll target for the frontend while a queued generation is in progress. */
  async getReportGenerationStatus(reportGenerationId: string, user: User) {
    const report = await this.prisma.reportGeneration.findUnique({
      where: { id: reportGenerationId },
      include: { project: { select: { testerId: true } } },
    });
    if (!report) {
      throw new NotFoundException('Report not found');
    }
    if (user.role === UserRole.TESTER && report.project.testerId !== user.id) {
      throw new NotFoundException('Report not found');
    }
    const fileName = report.docxPath ? report.docxPath.split('/').pop()?.replace(/^\d+_/, '') : null;
    return {
      status: report.status,
      version: report.version,
      error: report.error,
      fileName,
      docxUrl: report.status === 'COMPLETED' && report.docxPath
        ? await this.storage.getPresignedUrl(report.docxPath, 3600, fileName || undefined)
        : null,
    };
  }

  /**
   * Heavy path, runs in the background worker: builds and uploads the actual
   * document, then flips the ReportGeneration row to COMPLETED (or FAILED).
   */
  async processReportGeneration(
    reportGenerationId: string,
    actorId: string,
    ipAddress: string,
    userAgent: string,
  ): Promise<void> {
    const reportGeneration = await this.prisma.reportGeneration.findUnique({
      where: { id: reportGenerationId },
      include: { template: { include: { fields: true } } },
    });
    if (!reportGeneration) {
      this.logger.error(`processReportGeneration: report ${reportGenerationId} not found`);
      return;
    }

    try {
      // Access was already validated when this job was enqueued; ADMIN here
      // just bypasses loadProjectForReport's per-tester ownership check.
      const project = await this.loadProjectForReport(
        reportGeneration.projectId,
        { id: actorId, role: UserRole.ADMIN } as User,
      );
      const template = reportGeneration.template;
      if (!template) {
        throw new BadRequestException('The template used for this report generation no longer exists.');
      }

      const templateBuffer = await this.storage.getFile(template.filePath);

      const sortedFindings = project.findings
        .map((f) => ({
          ...f,
          effectiveScore: f.cvssScoreOverride ?? f.vulnerability.cvssScore ?? 0,
        }))
        .sort((a, b) => b.effectiveScore - a.effectiveScore);

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

      const { settings } = await this.settingsService.get();

      this.logger.log(`Generating report ${reportGenerationId} for project ${project.id} using template ${template.name}`);
      const reportBuffer = await this.docxManipulator.generateReport(
        templateBuffer,
        this.resolveMappedFieldsOrThrow(template, project)
          .concat(this.buildFieldRules(project))
          .concat(this.buildCustomFieldRules(project)),
        findingsData,
        images,
        this.buildContacts(project),
        settings.workflow.severityColors,
      );

      // File naming convention: App-Security-Test_{Client}-{App}_{SubType}_v{Version}_{YYYY-MM-DD}_Non-Compliant.docx
      const fileName = this.buildReportFileName(project, reportGeneration.version, template);
      const docxName = `reports/${project.id}/${Date.now()}_${fileName}`;
      await this.storage.uploadFile(
        docxName,
        reportBuffer,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );

      await this.prisma.reportGeneration.update({
        where: { id: reportGenerationId },
        data: { status: ReportGenerationStatus.COMPLETED, docxPath: docxName },
      });

      await this.prisma.project.update({
        where: { id: project.id },
        data: {
          reportDocxPath: docxName,
          reportPdfPath: null,
          generatedAt: new Date(),
          status: ProjectStatus.COMPLETED,
        },
      });

      await this.auditService.log({
        actorId,
        action: 'REPORT_GENERATED',
        targetType: 'PROJECT',
        targetId: project.id,
        ipAddress,
        userAgent,
        details: { templateId: template.id, format: 'docx', fileName, version: reportGeneration.version },
      });
    } catch (error: any) {
      this.logger.error(`Report generation ${reportGenerationId} failed`, error);
      await this.prisma.reportGeneration.update({
        where: { id: reportGenerationId },
        data: { status: ReportGenerationStatus.FAILED, error: error?.message || 'Unknown error' },
      });
    }
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
          select: { id: true, username: true, fullName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Attach presigned download URLs
    return Promise.all(
      history.map(async (h) => {
        const fileName = h.docxPath ? h.docxPath.split('/').pop()?.replace(/^\d+_/, '') : null;
        return {
          ...h,
          fileName,
          docxUrl: h.docxPath ? await this.storage.getPresignedUrl(h.docxPath, 3600, fileName || undefined) : null,
        };
      }),
    );
  }

  async removeReport(id: string, user: User, ipAddress: string, userAgent: string) {
    const report = await this.prisma.reportGeneration.findUnique({
      where: { id },
      include: { project: true },
    });

    if (!report) {
      throw new NotFoundException('Report not found');
    }

    const isOwner = user.role === UserRole.TESTER && report.project.testerId === user.id;
    if (user.role !== UserRole.ADMIN && !isOwner) {
      throw new ForbiddenException('Only the project owner or an Admin can delete a generated report');
    }

    if (report.docxPath) await this.storage.deleteFile(report.docxPath);
    if (report.pdfPath) await this.storage.deleteFile(report.pdfPath);

    await this.prisma.reportGeneration.delete({ where: { id } });

    await this.auditService.log({
      actorId: user.id,
      action: 'REPORT_DELETED',
      targetType: 'PROJECT',
      targetId: report.projectId,
      ipAddress,
      userAgent,
      details: { reportId: id },
    });
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async loadProjectForReport(projectId: string, user: User) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        template: { include: { fields: true } },
        tester: true,
        tl: { include: { manager: true } },
        findings: {
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
  /** Admin-added custom fields, filled from `project.customFieldValues`. */
  private buildCustomFieldRules(project: any): FieldRule[] {
    const values = project.customFieldValues as Record<string, string> | null;
    if (!values) return [];
    return Object.entries(values)
      .filter(([, value]) => value != null)
      .map(([match, value]) => ({ match: [match], value: String(value) }));
  }

  /**
   * Admin-set per-field mappings take priority over the generic fuzzy
   * matching in buildFieldRules() — each ties one specific template
   * placeholder to one specific application value, so two placeholders that
   * happen to fuzzy-match the same generic rule can still resolve
   * independently once an admin has mapped them.
   */
  private buildMappedFieldRules(template: any, project: any): FieldRule[] {
    return this.resolveMappedFields(template, project).rules;
  }

  /** Same as buildMappedFieldRules, but fails loudly instead of silently dropping an unresolved mapping. */
  private resolveMappedFieldsOrThrow(template: any, project: any): FieldRule[] {
    const { rules, unresolved } = this.resolveMappedFields(template, project);
    if (unresolved.length > 0) {
      const detail = unresolved.map((u) => `"${u.field}" (mapped to ${u.parameter})`).join(', ');
      throw new BadRequestException(
        `Cannot resolve mapped parameter for: ${detail}. Fill in the missing project data or remap the field in Template Mapping.`,
      );
    }
    return rules;
  }

  /**
   * Resolves every admin-mapped field for a template against the project.
   * A mapped field whose parameter resolves to an empty value is reported
   * as unresolved rather than silently generating a blank placeholder.
   */
  private resolveMappedFields(
    template: any,
    project: any,
  ): { rules: FieldRule[]; unresolved: { field: string; parameter: string }[] } {
    const fields = (template?.fields || []) as { name: string; normalizedName: string; mappedParameter: string | null }[];
    const rules: FieldRule[] = [];
    const unresolved: { field: string; parameter: string }[] = [];

    for (const f of fields) {
      if (!f.mappedParameter) continue;
      const value = resolveTemplateParameter(f.mappedParameter, project, (d) => this.formatReportDate(d));
      if (!value) {
        unresolved.push({ field: f.name, parameter: f.mappedParameter });
        continue;
      }
      rules.push({ match: [f.normalizedName], value });
    }

    return { rules, unresolved };
  }

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

  private buildReportFileName(project: any, version: string, template?: any): string {
    const subTypeLabel = SUB_TYPE_FILE_LABELS[(template?.subType ?? project.subType) as TemplateSubType] || 'Web';
    const safe = (s: string) =>
      (s || '')
        .trim()
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'NA';
    const date = new Date().toISOString().split('T')[0];
    return `App-Security-Test_${safe(project.clientName)}-${safe(project.name)}_${subTypeLabel}_v${version}_${date}_Non-Compliant.docx`;
  }

  /**
   * First generation for a project is v1.0; every subsequent generation
   * increments the minor version (v1.1, v1.2, ...) and never resets.
   *
   * ponytail: count-then-create isn't atomic under truly concurrent
   * generation for the same project — two simultaneous requests could
   * compute the same version. Acceptable for now since report generation
   * for one project is a rare, human-triggered action; if concurrent
   * generation of the SAME project becomes common, wrap this in the same
   * transaction as the ReportGeneration insert.
   */
  private async getNextReportVersion(projectId: string): Promise<string> {
    const count = await this.prisma.reportGeneration.count({ where: { projectId } });
    return `1.${count}`;
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
