import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException, ConflictException, Inject, forwardRef } from '@nestjs/common';
import { VULN_INCLUDE, withVulnerability } from '../common/finding-vulnerability.util';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from './storage.service';
import { DocxManipulatorService, FieldRule, FindingData, PocImage } from './docx-manipulator.service';
import { RowSet, XlsxTemplateService } from './xlsx-template.service';
import { NmapPortRecord } from '../common/nmap-parser.util';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { User, UserRole, TemplateCategory, TemplateSubType, ProjectStatus, ReportGenerationStatus, ReportFormat } from '@prisma/client';
import * as crypto from 'crypto';
import { REPORT_GENERATION_QUEUE, ReportGenerationJobData } from './report-generation.types';
import { findingPocReadiness } from '../common/poc-validation.util';
import { pocStepImagePaths } from '../common/poc-images.util';
import { LINE_SEP, nessusTextForReport, stripNessusBoilerplate } from '../common/nessus-text.util';
import { splitAuditDays, CANONICAL_TEMPLATE_PARAMETERS, CANONICAL_PARAMETER_KEYS, PLATFORM_TYPE_LABELS, resolveTemplateParameter } from './template-parameters';
import { canAccessProject } from '../common/project-access.util';
import { assertSafeDocx, safeFileName } from '../common/docx-package.util';
import { coveredSubTypes, coversSubType, coversAnySubType, eligibleForProject, isEligibleTemplate, parseExtraSubTypes } from './template-subtypes';
import { ISSUE_LOG_CATALOG, resolveIssueLogColumns, buildIssueLogCsv } from './issue-log';
import { formatReportDate as formatReportDateByPattern, DEFAULT_REPORT_DATE_FORMAT } from '../common/report-date-format';

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];
const severityRank = (sev: string) => {
  const i = SEVERITY_ORDER.indexOf((sev || '').toLowerCase().slice(0, 4) === 'info' ? 'info' : (sev || '').toLowerCase());
  return i === -1 ? SEVERITY_ORDER.length : i;
};

const SUB_TYPE_FILE_LABELS: Record<TemplateSubType, string> = {
  WEB: 'Web',
  API: 'API',
  MOBILE: 'Mobile',
  THICK_CLIENT: 'Thick-Client',
  NETWORK: 'Network',
  APPLICATION: 'Application',
};

/** The project's status as printed in reports and file names: "Compliant" / "Non-Compliant", empty while In-Progress or unset. */
const complianceStatusText = (status?: string | null): string => {
  const key = (status || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  return key === 'compliant' ? 'Compliant' : key === 'non-compliant' ? 'Non-Compliant' : '';
};

/** The project status (Compliance Status dropdown) that allows a report even with no findings. */
const REPORT_READY_STATUS = 'Compliant';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private docxManipulator: DocxManipulatorService,
    private xlsxTemplate: XlsxTemplateService,
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
    reportFormat: ReportFormat = ReportFormat.WORD,
    extraSubTypesRaw?: unknown,
  ) {
    const extraSubTypes = parseExtraSubTypes(extraSubTypesRaw, subType, category);
    if (reportFormat === ReportFormat.EXCEL) {
      return this.uploadExcelTemplate(file, name, category, subType, effectiveFrom, effectiveTo, adminId, ipAddress, userAgent, extraSubTypes);
    }
    if (!file?.buffer || !file.originalname.toLowerCase().endsWith('.docx')) {
      throw new BadRequestException(
        file?.originalname?.toLowerCase().endsWith('.xlsx')
          ? 'This is an .xlsx file: choose Report Type "Excel Report", or upload a .docx for a Word Report'
          : 'Only .docx templates are allowed for a Word Report',
      );
    }
    // Reject malformed/dangerous packages before anything is parsed, stored or written to the DB.
    await assertSafeDocx(file.buffer);

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
      where: { category, ...coversSubType(subType), isActive: true, reportFormat: ReportFormat.WORD },
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

    const objectName = `templates/${category}/${subType}/${Date.now()}_${safeFileName(file.originalname)}`;
    await this.storage.uploadFile(objectName, file.buffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

    // Uploads are created as INACTIVE drafts — activation is a separate,
    // explicit step after the admin reviews the validation report.
    const template = await this.prisma.reportTemplate.create({
      data: {
        name,
        filePath: objectName,
        originalFileName: file.originalname,
        fileHash,
        category,
        subType,
        extraSubTypes,
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
        name, category, subType, extraSubTypes,
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

  async getTemplates(category?: TemplateCategory, subType?: TemplateSubType, includeInactive = false, reportFormat?: ReportFormat, forProject = false) {
    const where: any = {};
    if (!includeInactive) where.isActive = true;
    if (reportFormat) where.reportFormat = reportFormat;
    if (category) where.category = category;
    // forProject: the project-eligibility rule (Cert-In Application umbrella); otherwise plain Activity Type coverage.
    if (subType) Object.assign(where, forProject && category ? eligibleForProject(category, subType) : coversSubType(subType));

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
    'application_name', 'app_version', 'version_ex', 'document_version', 'client_name_location', 'client_name', 'month_dd_yyyy',
    'tools_name', 'tools_used', 'details_scope', 'scope', 'staging_uat',
    'testing_environment', 'black_box', 'grey_box', 'login_role_types',
    'nature_or_purpose', 'testing_limitation', 'build_details',
    'manager', 'manager_designation', 'manager_phone', 'manager_email',
    'team_lead_designation', 'team_lead_phone', 'team_lead_email',
    'tester_designation', 'tester_phone', 'tester_email',
    'android_ios', 'sha_1', 'sha1', 'report_date',
    'external_internal', 'total_scope_count', 'quarter',
    'testing_type', 'platform_type', 'testing_approach', 'location',
    'client_spoc_name', 'client_spoc_designation', 'client_spoc_email',
  ];

  /** Slug: lowercase, spaces/dashes → underscore, strip anything else. */
  /**
   * Must normalize identically to DocxManipulatorService's normalizeFieldName
   * (non-alnum -> "_", not stripped) — filename resolution slugifies a raw
   * "{Parameter}" and matches it against the same FieldRule.match tokens
   * (e.g. "external_internal") that the doc-body resolver uses. Stripping
   * instead of substituting separators silently broke any placeholder with
   * a non-alnum character (e.g. "{External&Internal}" -> "externalinternal",
   * which never matches "external_internal").
   */
  private slugifyFieldName(raw: string): string {
    return raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
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

    // Activating (= approving) a template replaces whatever was active for the same category + Activity Type +
    // report format. Projects explicitly pinned to a replaced template are rebound to the new one first, so
    // Template Mapping and future generation resolve against the new template at once. A replaced template that
    // generated reports still point at is kept, inactive (history and audit); one nothing references is deleted,
    // file included. Reports already generated are never touched.
    //
    // All of it is one transaction, serialised per category + format by an advisory lock: a failure part-way
    // leaves the previously active template exactly as it was, and two concurrent activations cannot both win.
    // Stored files are only removed after the commit.
    const mine = coveredSubTypes(template);
    const orphanedFiles: string[] = [];
    const activated = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`template:${template.category}:${template.reportFormat}`}))`;
      const replaced = await tx.reportTemplate.findMany({
        where: {
          category: template.category,
          ...coversAnySubType(mine),
          reportFormat: template.reportFormat,
          isActive: true,
          id: { not: id },
        },
      });
      for (const old of replaced) {
        const overlap = coveredSubTypes(old).filter((t) => mine.includes(t));
        const remaining = coveredSubTypes(old).filter((t) => !mine.includes(t));
        if (remaining.length > 0) {
          // The old template also serves Activity Types this one doesn't: it keeps those and loses only the
          // overlap. Projects of the overlapping types move to the new template; nothing else is touched.
          const [primary, ...extra] = remaining;
          await tx.project.updateMany({ where: { templateId: old.id, subType: { in: overlap } }, data: { templateId: id } });
          await tx.reportTemplate.update({
            where: { id: old.id },
            data: { subType: primary, extraSubTypes: extra, projectType: `${old.category}_${primary}` },
          });
          continue;
        }
        const rebound = await tx.project.updateMany({ where: { templateId: old.id }, data: { templateId: id } });
        if (rebound.count > 0) {
          this.logger.log(`Rebound ${rebound.count} project(s) from replaced template ${old.id} to ${id}`);
        }
        if ((await tx.reportGeneration.count({ where: { templateId: old.id } })) > 0) {
          await tx.reportTemplate.update({ where: { id: old.id }, data: { isActive: false, effectiveTo: new Date() } });
        } else {
          await tx.reportTemplate.delete({ where: { id: old.id } });
          orphanedFiles.push(old.filePath);
        }
      }
      return tx.reportTemplate.update({ where: { id }, data: { isActive: true } });
    });
    for (const filePath of orphanedFiles) {
      await this.storage.deleteFile(filePath).catch((err) =>
        this.logger.warn(`Failed to delete replaced template file ${filePath}: ${err?.message}`),
      );
    }

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

  /**
   * Hard-deletes an inactive/replaced template: file + DB row + cascaded
   * field mappings. Active templates are never deletable here — same
   * FK-SetNull safety as the auto-delete-on-replace path means historical
   * ReportGeneration rows and their stored docx/pdf files are untouched.
   */
  async deleteTemplate(id: string, adminId: string, ipAddress: string, userAgent: string) {
    const template = await this.prisma.reportTemplate.findUnique({ where: { id } });
    if (!template) {
      throw new NotFoundException('Template not found');
    }
    if (template.isActive) {
      throw new BadRequestException('Cannot delete the active template — deactivate or replace it first.');
    }

    await this.storage.deleteFile(template.filePath).catch((err) =>
      this.logger.warn(`Failed to delete template file ${template.filePath}: ${err?.message}`),
    );
    await this.prisma.reportTemplate.delete({ where: { id } });

    await this.auditService.log({
      actorId: adminId,
      action: 'TEMPLATE_DELETED',
      targetType: 'TEMPLATE',
      targetId: id,
      ipAddress,
      userAgent,
      details: { name: template.name, category: template.category, subType: template.subType },
    });

    return { message: 'Template deleted' };
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
      const readiness = findingPocReadiness(finding, project.subType);
      if (readiness === 'both_missing') {
        missing.push({ field: 'pocStepsAndScreenshot', label: 'Steps & PoC Missing', source: `Finding: ${vulnName}` });
      } else if (readiness === 'steps_missing') {
        missing.push({ field: 'pocSteps', label: 'Steps Missing', source: `Finding: ${vulnName}` });
      } else if (readiness === 'poc_missing') {
        missing.push({ field: 'pocScreenshot', label: 'PoC Missing', source: `Finding: ${vulnName}` });
      }
    }
    const pocGateBlocked = project.findings.some((f) => findingPocReadiness(f, project.subType) !== 'ready');

    const nextVersion = await this.getNextReportVersion(projectId);
    const reportDate = await this.getFormattedReportDateParam();

    return {
      ready: missing.length === 0,
      missing,
      approvedFindings,
      pocGateBlocked,
      templateName: project.template?.name || null,
      nextVersion,
      suggestedFileName: this.buildReportFileName(project, nextVersion, project.template, reportDate),
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
    reportFormat: ReportFormat = ReportFormat.WORD,
  ) {
    const project = await this.loadProjectForReport(projectId, user);

    // Allowed with findings, or when the project's saved status (not its compliance category / testing type) is Compliant.
    if (project.findings.length === 0 && project.complianceStatus !== REPORT_READY_STATUS) {
      throw new BadRequestException(`This project has no findings and its status is "${project.complianceStatus ?? 'not set'}". Add findings, or set the status to "${REPORT_READY_STATUS}", before generating a report.`);
    }

    if (reportFormat === ReportFormat.EXCEL && project.subType !== TemplateSubType.NETWORK) {
      throw new BadRequestException('Excel reports are only available for Network projects');
    }

    const pocGateBlocked = project.findings.some((f) => findingPocReadiness(f, project.subType) !== 'ready');
    if (pocGateBlocked) {
      throw new BadRequestException('Report Generation not allowed until Steps and PoC screenshots/attachments are added.');
    }

    // Duplicate-submission / resource guard: one in-flight generation per project. The 10 min window
    // keeps a crashed job (never flipped to FAILED) from blocking the project forever.
    const inFlight = await this.prisma.reportGeneration.count({
      where: { projectId, status: ReportGenerationStatus.PENDING, createdAt: { gt: new Date(Date.now() - 10 * 60_000) } },
    });
    if (inFlight > 0) {
      throw new ConflictException('A report is already being generated for this project. Please wait for it to finish.');
    }

    // A project's pinned template is always a Word one; the Excel template is looked up by category + sub type.
    // The pinned template is checked again here: if it is no longer eligible (deactivated, replaced) the project
    // is re-pointed at the eligible one, never silently kept on a stale template.
    let template = reportFormat === ReportFormat.WORD && project.template?.reportFormat !== ReportFormat.EXCEL ? project.template : null;
    if (template && !isEligibleTemplate(template, project.category, project.subType, reportFormat)) template = null;
    if (!template) {
      template = await this.prisma.reportTemplate.findFirst({
        where: { isActive: true, category: project.category, ...eligibleForProject(project.category, project.subType), reportFormat },
        orderBy: { effectiveFrom: 'desc' },
        include: { fields: true },
      });
      if (template && reportFormat === ReportFormat.WORD && project.templateId !== template.id) {
        await this.prisma.project.update({ where: { id: project.id }, data: { templateId: template.id } });
      }
    }
    if (!template) {
      throw new BadRequestException(
        reportFormat === ReportFormat.EXCEL
          ? `No active Excel template is available for ${project.category} / ${project.subType}. Ask an Admin to upload and activate one, or generate the Word report instead.`
          : `No active template found for ${project.category} / ${project.subType}`,
      );
    }

    // Version auto-increments per project: first generation is 1.0, every
    // subsequent generation is 1.1, 1.2, ... and never resets. Computed
    // before the rules so Document Version can track it too.
    const version = await this.getNextReportVersion(projectId);
    const reportDate = await this.getFormattedReportDateParam();

    const rules = this.buildFieldRules(project, version, reportDate);
    rules.push(...this.buildCustomFieldRules(project));
    const fieldDataSnapshot = Object.fromEntries(rules.map((r) => [r.match[0], r.value]));

    const reportGeneration = await this.prisma.reportGeneration.create({
      data: {
        projectId,
        templateId: template.id,
        generatedById: user.id,
        fieldData: fieldDataSnapshot,
        version,
        status: ReportGenerationStatus.PENDING,
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
      include: { project: { select: { testerId: true, tlId: true, tester: { select: { assignedTlId: true } } } } },
    });
    if (!report) {
      throw new NotFoundException('Report not found');
    }
    if (!canAccessProject(user, report.project)) {
      throw new NotFoundException('Report not found');
    }
    const fileName = report.docxPath ? report.docxPath.split('/').pop()?.replace(/^\d+_/, '') : null;
    return {
      status: report.status,
      version: report.version,
      error: report.error,
      fileName,
      docxUrl: report.status === 'COMPLETED' && report.docxPath
        ? this.signedDownloadUrl(report.docxPath, fileName || 'report.docx')
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

      let templateBuffer: Buffer;
      try {
        templateBuffer = await this.storage.getFile(template.filePath);
      } catch (err: any) {
        // Never substitute another template on a load failure — fail loud
        // and name exactly which template/file could not be read.
        throw new BadRequestException(
          `Configured template "${template.name}" (id ${template.id}) could not be loaded from storage (${template.filePath}): ${err?.message || 'unknown error'}`,
        );
      }

      if (template.reportFormat === ReportFormat.EXCEL) {
        await this.processExcelGeneration(reportGenerationId, project, template, templateBuffer, actorId, ipAddress, userAgent, reportGeneration.version);
        return;
      }

      const certIn = template.category === TemplateCategory.CERT_IN;
      const sortedFindings = project.findings
        .map((f) => ({
          ...f,
          effectiveScore: f.cvssScoreOverride ?? f.vulnerability.cvssScore ?? 0,
        }))
        // Cert-In reports list findings strictly Critical → High → Medium → Low → Info
        // (score breaks ties); other report types keep the existing score-only order.
        .sort((a, b) => (certIn ? severityRank(this.effectiveSeverity(a)) - severityRank(this.effectiveSeverity(b)) : 0) || b.effectiveScore - a.effectiveScore);

      const images: PocImage[] = [];
      const findingsData: FindingData[] = [];
      for (let index = 0; index < sortedFindings.length; index++) {
        const f = sortedFindings[index];
        const effectiveScore = f.cvssScoreOverride ?? f.vulnerability.cvssScore;

        const pocSteps = [] as FindingData['pocSteps'];
        for (const step of f.pocSteps || []) {
          // Every PoC of the step, in its stored order; a file that can no longer be read is skipped, not fatal.
          const imageKeys: string[] = [];
          for (const [position, imagePath] of pocStepImagePaths(step).entries()) {
            try {
              const buffer = await this.storage.getFile(imagePath);
              const imageKey = `finding_${f.id}_step_${step.stepNo}_${position}`;
              const ext = (imagePath.split('.').pop() || 'png').toLowerCase();
              images.push({ key: imageKey, buffer, extension: ext === 'jpeg' ? 'jpg' : ext });
              imageKeys.push(imageKey);
            } catch (error) {
              this.logger.warn(`POC image not found in storage: ${imagePath}`);
            }
          }
          pocSteps.push({ stepNo: step.stepNo, description: step.description, imageKey: imageKeys[0] ?? null, imageKeys });
        }

        findingsData.push(this.toFindingData(f, index + 1, pocSteps));
      }

      const { settings } = await this.settingsService.get();
      const reportDate = formatReportDateByPattern(new Date(), settings.formatting?.reportDateFormat || DEFAULT_REPORT_DATE_FORMAT);

      // File naming: the template's own file name as a pattern; older templates without one use {Testing-Type}_{Client}_{App}_{Version}_{ReportDate}_{Status}-Report.docx
      // Computed before content generation so {Report Name} can resolve to the final filename.
      const fileName = this.buildReportFileName(project, reportGeneration.version, template, reportDate);

      this.logger.log(`Generating report ${reportGenerationId} for project ${project.id} using template ${template.name}`);
      const reportBuffer = await this.docxManipulator.generateReport(
        templateBuffer,
        this.buildMappedFieldRules(template, project, reportGeneration.version, reportDate, fileName)
          .concat(this.buildFieldRules(project, reportGeneration.version, reportDate))
          .concat(this.buildCustomFieldRules(project)),
        findingsData,
        images,
        this.buildContacts(project),
        settings.workflow.severityColors,
        (project.networkScope as { ip: string; domainHostname: string; purpose: string }[] | null) || [],
        (project.nmapPorts as NmapPortRecord[] | null) || [],
        (project.toolsUsedTable as { name: string; version: string; licenseType: string }[] | null) || [],
        fileName,
        { splitVaPt: project.subType === 'NETWORK', activityType: project.subType === 'NETWORK' ? project.networkActivityType : null, complianceStatus: project.complianceStatus },
      );

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
          reportVersionCounter: { increment: 1 },
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

  // ---------------------------------------------------------------------------
  // Excel (.xlsx) templates
  // ---------------------------------------------------------------------------

  /**
   * Same rule order the Word report uses (admin-mapped, then built-in, then custom) and the very same
   * lookup (DocxManipulatorService.buildResolver), exposed to the workbook by raw placeholder text.
   */
  private excelResolver(template: any, project: any, version: string, reportDate: string, reportName?: string) {
    const rules = this.buildMappedFieldRules(template, project, version, reportDate, reportName)
      .concat(this.buildFieldRules(project, version, reportDate))
      .concat(this.buildCustomFieldRules(project));
    const lookup = this.docxManipulator.buildResolver(rules);
    return (raw: string) => {
      const name = this.slugifyFieldName(raw).substring(0, 100);
      if (!name) return undefined;
      if (name === 'report_name' && reportName) return reportName;
      return lookup(name);
    };
  }

  private async uploadExcelTemplate(
    file: Express.Multer.File,
    name: string,
    category: TemplateCategory,
    subType: TemplateSubType,
    effectiveFrom: Date,
    effectiveTo: Date | null,
    adminId: string,
    ipAddress: string,
    userAgent: string,
    extraSubTypes: TemplateSubType[] = [],
  ) {
    if (!file.originalname.toLowerCase().endsWith('.xlsx')) {
      throw new BadRequestException(
        file.originalname.toLowerCase().endsWith('.docx')
          ? 'This is a .docx file: choose Report Type "Word Report", or upload an .xlsx for an Excel Report'
          : 'Only .xlsx templates are allowed for an Excel Report',
      );
    }

    const fileHash = crypto.createHash('sha256').update(file.buffer).digest('hex');

    let rawNames: string[];
    try {
      rawNames = await this.xlsxTemplate.extractPlaceholders(file.buffer);
    } catch (error: any) {
      throw new BadRequestException(`Could not read the Excel template: ${error?.message || 'invalid workbook'}`);
    }

    // Same normalisation and categorisation as Word placeholders, so the same names land in the same groups.
    const seen = new Set<string>();
    const analysed = rawNames
      .map((raw) => ({ raw, normalizedName: this.slugifyFieldName(raw).substring(0, 100) }))
      .filter((f) => f.normalizedName && !seen.has(f.normalizedName) && !!seen.add(f.normalizedName))
      .map((f) => ({
        name: f.raw,
        normalizedName: f.normalizedName,
        category: this.docxManipulator.categorizeFieldName(f.raw),
        description: f.raw,
        isRepeatable: false,
      }));

    // Admin should not have to map again: start from the mappings already saved on the active Word template
    // of the same category + sub type (copied by name; that template is not modified).
    const wordTemplate = await this.prisma.reportTemplate.findFirst({
      where: { category, ...coversSubType(subType), isActive: true, reportFormat: ReportFormat.WORD },
      include: { fields: true },
      orderBy: { effectiveFrom: 'desc' },
    });
    const savedMapping = new Map((wordTemplate?.fields || []).filter((f) => f.mappedParameter).map((f) => [f.normalizedName, f.mappedParameter!]));

    const previousActive = await this.prisma.reportTemplate.findFirst({
      where: { category, ...coversSubType(subType), isActive: true, reportFormat: ReportFormat.EXCEL },
      include: { fields: true },
      orderBy: { effectiveFrom: 'desc' },
    });
    const newNames = new Set(analysed.map((f) => f.normalizedName));
    const oldNames = new Set((previousActive?.fields || []).map((f) => f.normalizedName));
    const fieldDiff = {
      added: [...newNames].filter((n) => !oldNames.has(n)),
      removed: [...oldNames].filter((n) => !newNames.has(n)),
      comparedTo: previousActive ? previousActive.name : null,
    };

    // Dry run against sample data: proves the workbook can be rewritten before it can be activated.
    let dryRunOk = false;
    let dryRunError: string | null = null;
    try {
      await this.xlsxTemplate.fill(file.buffer, () => 'Dry Run');
      dryRunOk = true;
    } catch (error: any) {
      dryRunError = error?.message || 'Dry-run generation failed';
    }

    const objectName = `templates/${category}/${subType}/${Date.now()}_${file.originalname}`;
    await this.storage.uploadFile(objectName, file.buffer, file.mimetype);

    const template = await this.prisma.reportTemplate.create({
      data: {
        name,
        filePath: objectName,
        originalFileName: file.originalname,
        fileHash,
        category,
        subType,
        extraSubTypes,
        projectType: `${category}_${subType}`,
        reportFormat: ReportFormat.EXCEL,
        effectiveFrom,
        effectiveTo,
        isActive: false,
        uploadedById: adminId,
        fields: {
          create: analysed.map((field, index) => ({
            name: field.name,
            normalizedName: field.normalizedName,
            category: field.category.toUpperCase() as any,
            description: field.description,
            isRepeatable: field.isRepeatable,
            sortOrder: index,
            mappedParameter: savedMapping.get(field.normalizedName) ?? null,
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
      details: { name, category, subType, extraSubTypes, reportFormat: 'EXCEL', fieldCount: analysed.length, dryRunOk },
    });

    return {
      ...template,
      validation: {
        fieldCount: analysed.length,
        hasSummaryTable: null,
        hasDetailedTable: null,
        missingMandatory: [] as string[],
        warnings: analysed.length === 0 ? ['No {Parameter} placeholders were found on any worksheet.'] : [],
        dryRunOk,
        dryRunError,
        fieldDiff,
        canActivate: dryRunOk,
      },
    };
  }

  /** One finding as the report engines read it. VA (scan-imported) text is tidied for print; stored data is untouched. */
  private toFindingData(f: any, no: number, pocSteps: FindingData['pocSteps']): FindingData {
    const isVa = f.findingType === 'VA';
    return {
      no,
      title: f.vulnerability.name,
      severity: f.cvssScoreOverride != null
        ? this.severityFromScore(f.cvssScoreOverride)
        : f.vulnerability.severity,
      cvssScore: f.cvssScoreOverride ?? f.vulnerability.cvssScore,
      cvssVector: f.cvssVectorOverride ?? f.vulnerability.cvssVector,
      description: isVa ? nessusTextForReport(stripNessusBoilerplate(f.vulnerability.description)) : f.vulnerability.description,
      impact: f.vulnerability.impact,
      remediation: f.vulnerability.remediation,
      references: f.vulnerability.references,
      cveId: f.vulnerability.cveId,
      cweId: f.vulnerability.cweId,
      affectedInstances: (f.affectedInstances || []).join('\n'),
      authenticationType: f.authenticationType,
      vulnerabilityDependency: f.vulnerabilityDependency,
      reportStatus: f.reportStatus,
      classification: f.classification,
      // Scan-imported (VA) findings only: PT findings never get scan output printed.
      pocText: f.classification ? nessusTextForReport(f.proofOfConcept) || null : null,
      findingType: f.findingType,
      pocSteps,
    };
  }

  /**
   * Rows of an Excel template that repeat per record: scope entries, Port Scan results and findings (VA and PT
   * kept apart in Network projects, as in Word). Values come from the same sources as the Word report:
   * the finding-level Application Parameter Registry and the project's saved scope / scan data.
   */
  private excelRowSets(template: any, project: any): RowSet[] {
    const certIn = template.category === TemplateCategory.CERT_IN;
    const sorted = project.findings
      .map((f: any) => ({ f, score: f.cvssScoreOverride ?? f.vulnerability.cvssScore ?? 0 }))
      .sort((a: any, b: any) => (certIn ? severityRank(this.effectiveSeverity(a.f)) - severityRank(this.effectiveSeverity(b.f)) : 0) || b.score - a.score)
      .map(({ f }: any) => f);
    const split = project.subType === 'NETWORK';
    const resolversFor = (list: any[]) =>
      list.map((f, i) => {
        const data = this.toFindingData(f, i + 1, []);
        // Excel cells take real line breaks; Word's line-separator marker becomes one here.
        return (raw: string) => this.docxManipulator.resolveFindingParameter(this.slugifyFieldName(raw).substring(0, 100), data)?.split(LINE_SEP).join('\n');
      });
    const lc = (names: string[]) => names.map((n) => n.toLowerCase());
    const scope = ((project.networkScope as { ip: string; domainHostname: string; purpose: string }[] | null) || []).map((e) => (raw: string) => {
      const n = raw.toLowerCase();
      if (n === 'ip') return e.ip || 'NA';
      if (n.includes('domain')) return e.domainHostname || 'NA';
      if (n === 'purpose') return e.purpose || 'NA';
      return undefined;
    });
    const ports = ((project.nmapPorts as NmapPortRecord[] | null) || []).map((r) => (raw: string) => {
      const n = raw.toLowerCase();
      if (n.includes('nmap')) return r.ip || 'NA';
      if (n === 'port') return r.port || 'NA';
      if (n === 'protocol') return r.protocol || 'NA';
      if (n === 'service') return r.service || 'NA';
      if (n === 'status') return r.status || 'NA';
      return undefined;
    });
    return [
      { claims: (names) => lc(names).includes('ip') && lc(names).includes('purpose'), rows: scope },
      { claims: (names) => lc(names).includes('port') && lc(names).some((n) => n.includes('nmap')), rows: ports },
      { claims: (names) => lc(names).some((n) => n.startsWith('va ')), rows: resolversFor(sorted.filter((f: any) => f.findingType === 'VA')) },
      { claims: (names) => lc(names).includes('vulnerability name'), rows: resolversFor(split ? sorted.filter((f: any) => f.findingType !== 'VA') : sorted) },
    ];
  }

  private async processExcelGeneration(
    reportGenerationId: string,
    project: any,
    template: any,
    templateBuffer: Buffer,
    actorId: string,
    ipAddress: string,
    userAgent: string,
    version: string,
  ): Promise<void> {
    const { settings } = await this.settingsService.get();
    const reportDate = formatReportDateByPattern(new Date(), settings.formatting?.reportDateFormat || DEFAULT_REPORT_DATE_FORMAT);
    const fileName = this.buildReportFileName(project, version, template, reportDate);

    this.logger.log(`Generating Excel report ${reportGenerationId} for project ${project.id} using template ${template.name}`);
    const resolver = this.excelResolver(template, project, version, reportDate, fileName);
    const buffer = await this.xlsxTemplate.fill(templateBuffer, resolver, { complianceStatus: project.complianceStatus, rowSets: this.excelRowSets(template, project) });

    const objectName = `reports/${project.id}/${Date.now()}_${fileName}`;
    await this.storage.uploadFile(objectName, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    await this.prisma.reportGeneration.update({
      where: { id: reportGenerationId },
      data: { status: ReportGenerationStatus.COMPLETED, docxPath: objectName },
    });
    await this.prisma.project.update({
      where: { id: project.id },
      data: { generatedAt: new Date(), status: ProjectStatus.COMPLETED, reportVersionCounter: { increment: 1 } },
    });
    await this.auditService.log({
      actorId,
      action: 'REPORT_GENERATED',
      targetType: 'PROJECT',
      targetId: project.id,
      ipAddress,
      userAgent,
      details: { templateId: template.id, format: 'xlsx', fileName, version },
    });
  }

  /**
   * Issue Log CSV. Same template/structure for every compliance + testing
   * type; columns (and their order) come from Admin Settings > Issue Log
   * Parameters, values from the existing finding parameter registry. Nothing
   * is persisted, so changing the config never alters an Issue Log that was
   * already downloaded.
   * Filename: Issue-Log_{Compliance Type}_{Sub Type}_{Client Name}-{Application Name}_v0.1_{Report Date}_{Compliance Status}.csv
   */
  async generateIssueLog(projectId: string, user: User) {
    const project = await this.loadProjectForReport(projectId, user);
    const { settings } = await this.settingsService.get();
    const columns = resolveIssueLogColumns((settings as any).issueLog?.columns);

    const rows = project.findings
      .map((f) => ({ f, score: f.cvssScoreOverride ?? f.vulnerability.cvssScore ?? 0 }))
      .sort((a, b) => b.score - a.score) // same order as the report
      .map(({ f }, i) => {
        const finding: FindingData = {
          no: i + 1,
          title: f.vulnerability.name,
          severity: f.cvssScoreOverride != null ? this.severityFromScore(f.cvssScoreOverride) : f.vulnerability.severity,
          cvssScore: f.cvssScoreOverride ?? f.vulnerability.cvssScore,
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
          pocSteps: [],
        };
        return columns.map((c) =>
          c.constant ?? (c.key === 's_no' ? String(finding.no) : this.docxManipulator.resolveFindingParameter(c.key, finding) ?? ''),
        );
      });

    const reportDate = await this.getFormattedReportDateParam();
    const fmt = (d: any) => this.formatReportDate(d);
    const safe = (s: string) => (s || 'NA').trim().replace(/[\s<>:"/\|?*]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '') || 'NA';
    const complianceType = (project.complianceType || project.category || '').toString().replace(/_/g, '-');
    const fileName = [
      'Issue-Log',
      safe(complianceType),
      SUB_TYPE_FILE_LABELS[project.subType as TemplateSubType] || safe(project.subType),
      `${safe(resolveTemplateParameter('project.clientName', project, fmt))}-${safe(resolveTemplateParameter('project.applicationName', project, fmt))}`,
      'v0.1',
      safe(resolveTemplateParameter('report.generationDateIso', project, fmt, undefined, reportDate)),
      complianceStatusText(project.complianceStatus),
    ].filter(Boolean).join('_');

    return { fileName: `${fileName}.csv`, csv: buildIssueLogCsv(columns, rows) };
  }

  async getReportHistory(projectId: string, user: User) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { tester: { select: { assignedTlId: true } } },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    if (!canAccessProject(user, project)) {
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
          docxUrl: h.docxPath ? this.signedDownloadUrl(h.docxPath, fileName || 'report.docx') : null,
        };
      }),
    );
  }

  /**
   * Download links go through this API (not straight to MinIO), so they work
   * for anyone who can reach the app, e.g. over a tunnel. Like the MinIO links
   * they replace, they carry no login: an HMAC over path + name + expiry makes
   * them unforgeable, and they expire after an hour.
   */
  private downloadSig(path: string, fileName: string, exp: number): string {
    const key = `report-download:${this.configService.get('JWT_ACCESS_SECRET')}`;
    return crypto.createHmac('sha256', key).update(`${path}\n${fileName}\n${exp}`).digest('base64url');
  }

  private signedDownloadUrl(path: string, fileName: string): string {
    const exp = Date.now() + 3600_000;
    const qs = new URLSearchParams({ path, fn: fileName, exp: String(exp), sig: this.downloadSig(path, fileName, exp) });
    return `/api/reports/download?${qs}`;
  }

  async readSignedDownload(path: string, fileName: string, exp: string, sig: string) {
    const expected = Buffer.from(this.downloadSig(path ?? '', fileName ?? '', Number(exp)));
    const given = Buffer.from(sig ?? '');
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected) || !(Number(exp) > Date.now())) {
      throw new ForbiddenException('This download link is invalid or has expired.');
    }
    return { buffer: await this.storage.getFile(path), fileName };
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
            ...VULN_INCLUDE,
            pocSteps: { orderBy: { stepNo: 'asc' } },
          },
        },
      },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    if (!canAccessProject(user, project)) {
      throw new NotFoundException('Project not found');
    }

    // Global-library and project-scoped (e.g. Nessus) findings both reach the report as `f.vulnerability`.
    return { ...project, findings: project.findings.map(withVulnerability) };
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
  /**
   * Automatic/admin-mapped resolution is best-effort: an unresolved mapping
   * is a valid state (left as literal template text, same as any other
   * unmapped {Parameter}), never a reason to block generation. Logged for
   * developer diagnostics only — never surfaced to users or thrown.
   */
  private buildMappedFieldRules(template: any, project: any, version?: string, reportDate?: string, reportName?: string): FieldRule[] {
    const { rules, unresolved } = this.resolveMappedFields(template, project, version, reportDate, reportName);
    if (unresolved.length > 0) {
      this.logger.debug(
        `Unresolved mapped parameter(s) left as literal template text: ${unresolved
          .map((u) => `"${u.field}" (${u.parameter})`)
          .join(', ')}`,
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
    version?: string,
    reportDate?: string,
    reportName?: string,
  ): { rules: FieldRule[]; unresolved: { field: string; parameter: string }[] } {
    const fields = (template?.fields || []) as { name: string; normalizedName: string; mappedParameter: string | null }[];
    const rules: FieldRule[] = [];
    const unresolved: { field: string; parameter: string }[] = [];

    for (const f of fields) {
      if (!f.mappedParameter) continue;
      const value = resolveTemplateParameter(f.mappedParameter, project, (d) => this.formatReportDate(d), version, reportDate, reportName);
      if (!value) {
        unresolved.push({ field: f.name, parameter: f.mappedParameter });
        continue;
      }
      rules.push({ match: [f.normalizedName], value });
    }

    return { rules, unresolved };
  }

  private buildFieldRules(project: any, version?: string, reportDate?: string): FieldRule[] {
    const tl = project.tl;
    const tester = project.tester;
    const manager = project.tl?.manager;

    const appLabel = project.subType === 'API' ? 'API' : 'Application';

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
      { match: ['manager_designation'], value: manager?.designation || 'N/A' },
      { match: ['manager_phone'], value: manager?.phone || 'N/A' },
      { match: ['manager_email'], value: manager?.email || 'N/A' },
      { match: ['manager'], value: manager?.fullName || manager?.username || 'N/A' },
      { match: ['team_lead_designation'], value: tl?.designation || 'N/A' },
      { match: ['team_lead_phone'], value: tl?.phone || 'N/A' },
      { match: ['team_lead_email'], value: tl?.email || 'N/A' },
      { match: ['tester_designation'], value: tester?.designation || 'N/A' },
      { match: ['tester_phone'], value: tester?.phone || 'N/A' },
      { match: ['tester_email'], value: tester?.email || 'N/A' },
      // {Application Name} and {App-Version} are independent parameters with
      // independent application fields — never combined/inferred from
      // each other. project.name and project.appVersion are matched
      // separately so a template using only one of the two still resolves
      // correctly.
      { match: ['application_name'], value: project.name || `${appLabel} Name` },
      { match: ['app_version'], value: project.appVersion || '' },
      // Document Version tracks this generation's progressive report version
      // (1.0, 1.1, 1.2, ...) rather than the static field, same as the report
      // version counter — applies to every testing type uniformly.
      { match: ['version_ex', 'document_version'], value: version || project.documentVersion || '1.0' },
      // Client SPOC (point of contact): optional on the project, so an empty one prints N/A like the other contact fields.
      { match: ['client_spoc_name'], value: project.clientSpocName || 'N/A' },
      { match: ['client_spoc_designation'], value: project.clientSpocDesignation || 'N/A' },
      { match: ['client_spoc_email'], value: project.clientSpocEmail || 'N/A' },
      { match: ['client_name_location'], value: [project.clientName, project.location].filter(Boolean).join(', ') },
      { match: ['client_name'], value: project.clientName || '' },
      { match: ['month_dd_yyyy'], value: this.formatReportDate(new Date()) },
      { match: ['tools_name', 'tools_used'], value: project.toolsUsed || '' },
      { match: ['details_scope'], value: [project.applicationDetails, project.scope].filter(Boolean).join('\n') },
      // total_scope_count must be checked before the bare 'scope' rule below —
      // .find() takes the first match, and "total_scope_count".includes("scope")
      // is true, so 'scope' was winning and leaving {Total Scope Count} blank.
      { match: ['total_scope_count'], value: project.totalScopeCount != null ? String(project.totalScopeCount) : '' },
      { match: ['scope'], value: project.scope || '' },
      { match: ['staging_uat', 'testing_environment'], value: project.testingEnvironment || '' },
      { match: ['black_box', 'grey_box', 'testing_approach'], value: project.testingType || '' },
      { match: ['login_role_types'], value: project.loginSystemTypes || '' },
      { match: ['nature_or_purpose'], value: project.applicationNature || '' },
      { match: ['testing_limitation'], value: project.testingLimitation || 'N/A' },
      { match: ['build_details'], value: project.applicationDetails || '' },
      { match: ['android_ios'], value: project.mobilePlatform || '' },
      { match: ['sha_1', 'sha1'], value: project.sha1 || '' },
      { match: ['external_internal'], value: project.externalInternal || '' },
      { match: ['vapt'], value: project.networkActivityType || '' },
      { match: ['quarter'], value: project.quarter || '' },
      // {Number of Days} repeats once per audit phase (Planning, Information
      // Gathering, Scanning & Exploitation, Reporting), in that document order.
      ...(splitAuditDays(project.startDate, project.endDate).length
        ? [{ match: ['number_of_days'], value: '', values: splitAuditDays(project.startDate, project.endDate) }]
        : []),
      { match: ['report_date'], value: reportDate ?? new Date().toISOString().slice(0, 10) },
      { match: ['testing_type', 'platform_type'], value: PLATFORM_TYPE_LABELS[project.subType] || project.subType || '' },
      { match: ['location'], value: project.location || '' },
    ];
  }

  /**
   * The generated report's filename follows the uploaded template's own
   * filename as a naming pattern: every {Parameter} in it is resolved
   * through the exact same rule set (admin-mapped > generic > custom) used
   * for report content, in place, then any run of whitespace is collapsed
   * to a single "-" so the result never contains spaces. Falls back to the
   * old fixed pattern only for templates uploaded before this existed.
   */
  private buildReportFileName(project: any, version: string, template?: any, reportDate?: string): string {
    if (!template?.originalFileName) {
      return this.buildLegacyReportFileName(project, version, template, reportDate);
    }

    // {Compliance Status} / {Project Status}: same wording the report body prints (empty while In-Progress).
    const statusText = complianceStatusText(project.complianceStatus);
    const rules = this.buildMappedFieldRules(template, project, version, reportDate)
      .concat([{ match: ['compliance_status', 'project_status'], value: statusText }])
      .concat(this.buildFieldRules(project, version, reportDate))
      .concat(this.buildCustomFieldRules(project));

    const resolved = template.originalFileName.replace(/\{([^{}]+)\}/g, (match: string, raw: string) => {
      const normalized = this.slugifyFieldName(raw);
      const rule = rules.find((r) =>
        r.requireAll ? r.match.every((m) => normalized.includes(m)) : r.match.some((m) => normalized.includes(m)),
      );
      return rule ? rule.value : match; // leave unmapped placeholders literal, same as report content
    });

    const extMatch = resolved.match(/\.[a-zA-Z0-9]+$/)?.[0];
    const ext = extMatch || '.docx'; // uploaded templates are always .docx; this only guards a malformed/no-extension original filename
    const base = extMatch ? resolved.slice(0, -extMatch.length) : resolved;
    const sanitizedBase = base
      .replace(/\s+/g, '-') // no spaces, ever — applies to both static text and resolved values
      .replace(/[<>:"/\\|?*]+/g, '-') // strip filesystem-invalid characters
      .replace(/-{2,}/g, '-')
      .replace(/_{2,}/g, '_') // an empty value (e.g. no {Quarter}) must not leave "__" between its neighbours
      .replace(/^[-_]+|[-_]+$/g, '');

    return `${sanitizedBase || 'Report'}${ext}`;
  }

  private buildLegacyReportFileName(project: any, version: string, template?: any, reportDate?: string): string {
    const subTypeLabel = SUB_TYPE_FILE_LABELS[(template?.subType ?? project.subType) as TemplateSubType] || 'Web';
    const safe = (s: string) =>
      (s || '')
        .trim()
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'NA';
    // safe() rather than raw — some report date formats (e.g. DD/MM/YYYY)
    // contain filesystem path separators.
    const date = safe(reportDate ?? new Date().toISOString().split('T')[0]);
    const status = complianceStatusText(project.complianceStatus);
    return `${subTypeLabel}_${safe(project.clientName)}_${safe(project.name)}_${version}_${date}_${status ? `${status}-` : ''}Report.docx`;
  }

  /**
   * First generation for a project is v1.0; every subsequent generation
   * increments the minor version (v1.1, v1.2, ...) and never resets. Based
   * on project.reportVersionCounter, which only advances when a generation
   * actually COMPLETEs (see processReportGeneration) — so a failed
   * generation doesn't burn a version number, and deleting an old report
   * can't cause version reuse or renumbering.
   *
   * ponytail: read-then-create isn't atomic under truly concurrent
   * generation for the same project — two simultaneous requests could
   * compute the same version. Acceptable for now since report generation
   * for one project is a rare, human-triggered action; if concurrent
   * generation of the SAME project becomes common, wrap this in the same
   * transaction as the ReportGeneration insert.
   */
  private async getNextReportVersion(projectId: string): Promise<string> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { reportVersionCounter: true } });
    return `1.${project?.reportVersionCounter ?? 0}`;
  }

  private formatReportDate(date: Date | string | null | undefined): string {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: '2-digit' });
  }

  /**
   * The {Report Date} parameter's value, in the admin-configured format —
   * the single place this gets computed, so report content, report
   * filenames, and Issue Log filenames all stay in sync with the setting.
   */
  private async getFormattedReportDateParam(): Promise<string> {
    const { settings } = await this.settingsService.get();
    const pattern = settings.formatting?.reportDateFormat || DEFAULT_REPORT_DATE_FORMAT;
    return formatReportDateByPattern(new Date(), pattern);
  }

  private effectiveSeverity(f: any): string {
    return f.cvssScoreOverride != null ? this.severityFromScore(f.cvssScoreOverride) : f.vulnerability.severity;
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
