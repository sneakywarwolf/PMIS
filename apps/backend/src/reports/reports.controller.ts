import { Controller, Get, Post, Put, Delete, Body, Param, Req, Res, UseGuards, UseInterceptors, UploadedFile, Query, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AttachmentSizeGuard, assertAttachmentSize, attachmentMulterLimits } from '../common/attachment-upload';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/roles.decorator';
import { User, UserRole, TemplateCategory, TemplateSubType, ReportFormat } from '@prisma/client';
import { Permission } from '../common/permissions';

@ApiTags('Reports & Templates')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  // Template Management
  @Post('templates')
  @Permission('templates.upload')
  @UseGuards(AttachmentSizeGuard('template'))
  @UseInterceptors(FileInterceptor('file', attachmentMulterLimits('template')))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload report template with field extraction' })
  async uploadTemplate(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: {
      name: string;
      category: TemplateCategory;
      subType: TemplateSubType;
      // Additional Activity Types for the same template (JSON array or comma-separated); subType stays the primary.
      extraSubTypes?: string;
      reportFormat?: ReportFormat;
      effectiveFrom: string;
      effectiveTo?: string;
    },
    @CurrentUser('id') adminId: string,
    @Req() request: any,
  ) {
    assertAttachmentSize('template', file);
    const ipAddress = request.ip || 'unknown';
    const userAgent = request.headers['user-agent'] || 'unknown';
    return this.reportsService.uploadTemplate(
      file,
      body.name,
      body.category,
      body.subType,
      new Date(body.effectiveFrom),
      body.effectiveTo ? new Date(body.effectiveTo) : null,
      adminId,
      ipAddress,
      userAgent,
      body.reportFormat ?? ReportFormat.WORD,
      body.extraSubTypes,
    );
  }

  @Get('templates')
  @Permission('templates.view')
  @ApiOperation({ summary: 'List active templates with optional filtering' })
  async getTemplates(
    @Query('category') category?: TemplateCategory,
    @Query('subType') subType?: TemplateSubType,
    @Query('reportFormat') reportFormat?: ReportFormat,
    @Query('forProject') forProject?: string,
  ) {
    return this.reportsService.getTemplates(category, subType, false, reportFormat, forProject === 'true');
  }

  @Get('templates/all')
  @Permission('templates.view_all')
  @ApiOperation({ summary: 'List all templates including inactive drafts (admin)' })
  async getAllTemplates(
    @Query('category') category?: TemplateCategory,
    @Query('subType') subType?: TemplateSubType,
    @Query('reportFormat') reportFormat?: ReportFormat,
  ) {
    return this.reportsService.getTemplates(category, subType, true, reportFormat);
  }

  @Post('templates/:id/fields')
  @Permission('templates.edit_fields')
  @ApiOperation({ summary: 'Manually add a field the extractor missed' })
  async addTemplateField(
    @Param('id') id: string,
    @Body() body: { name: string; normalizedName: string; category: string; description?: string },
    @CurrentUser('id') adminId: string,
  ) {
    return this.reportsService.addTemplateField(id, body, adminId);
  }

  @Put('templates/fields/:fieldId')
  @Permission('templates.edit_fields')
  @ApiOperation({ summary: 'Edit a template field label/category/description/parameter mapping' })
  async updateTemplateField(
    @Param('fieldId') fieldId: string,
    @Body() body: { name?: string; category?: string; description?: string; mappedParameter?: string | null },
  ) {
    return this.reportsService.updateTemplateField(fieldId, body);
  }

  @Get('templates/parameters')
  @Permission('templates.edit_fields')
  @ApiOperation({ summary: 'List canonical application parameters a template field can be mapped to' })
  getTemplateParameters() {
    return this.reportsService.getTemplateParameters();
  }

  @Get('templates/:id/fields')
  @Permission('templates.view')
  @ApiOperation({ summary: 'Get extracted fields for a template' })
  async getTemplateFields(@Param('id') id: string) {
    return this.reportsService.getTemplateFields(id);
  }

  @Put('templates/:id/activate')
  @Permission('templates.activate')
  @ApiOperation({ summary: 'Activate template' })
  async activateTemplate(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
    @Req() request: any,
  ) {
    const ipAddress = request.ip || 'unknown';
    const userAgent = request.headers['user-agent'] || 'unknown';
    return this.reportsService.activateTemplate(id, adminId, ipAddress, userAgent);
  }

  @Put('templates/:id/deactivate')
  @Permission('templates.activate')
  @ApiOperation({ summary: 'Deactivate template' })
  async deactivateTemplate(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
    @Req() request: any,
  ) {
    const ipAddress = request.ip || 'unknown';
    const userAgent = request.headers['user-agent'] || 'unknown';
    return this.reportsService.deactivateTemplate(id, adminId, ipAddress, userAgent);
  }

  @Delete('templates/:id')
  @Permission('templates.delete')
  @ApiOperation({ summary: 'Permanently delete an inactive template (file + metadata + mappings)' })
  async deleteTemplate(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
    @Req() request: any,
  ) {
    const ipAddress = request.ip || 'unknown';
    const userAgent = request.headers['user-agent'] || 'unknown';
    return this.reportsService.deleteTemplate(id, adminId, ipAddress, userAgent);
  }

  // Report Generation
  @Post('generate')
  @Permission('reports.generate')
  @ApiOperation({ summary: 'Generate report — all data pulled automatically from project, profiles and findings' })
  async generateReport(
    @Body() body: { projectId: string; reportFormat?: ReportFormat },
    @CurrentUser() user: User,
    @Req() request: any,
  ) {
    if (!body.projectId) {
      throw new BadRequestException('projectId is required');
    }
    const ipAddress = request.ip || 'unknown';
    const userAgent = request.headers['user-agent'] || 'unknown';
    return this.reportsService.generateReport(
      body.projectId,
      user,
      ipAddress,
      userAgent,
      body.reportFormat ?? ReportFormat.WORD,
    );
  }

  @Public()
  @Get('download')
  @ApiOperation({ summary: 'Download a generated report via a signed, expiring link' })
  async download(
    @Query('path') path: string,
    @Query('fn') fn: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() res: any,
  ) {
    const { buffer, fileName } = await this.reportsService.readSignedDownload(path, fn, exp, sig);
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${fileName.replace(/["\\\r\n]/g, '_')}"`,
    });
    res.send(buffer);
  }

  @Get('generate/:id/status')
  @Permission('reports.generate')
  @ApiOperation({ summary: 'Poll a queued/in-progress report generation for completion' })
  async getGenerationStatus(@Param('id') id: string, @CurrentUser() user: User) {
    return this.reportsService.getReportGenerationStatus(id, user);
  }

  @Get('preflight/:projectId')
  @Permission('reports.generate')
  @ApiOperation({ summary: 'Pre-generation completeness check (missing data report)' })
  async preflight(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
  ) {
    return this.reportsService.preflight(projectId, user);
  }

  @Get('issue-log/:projectId')
  @Permission('reports.issue_log')
  @ApiOperation({ summary: 'Generate the Issue Log CSV (columns per Admin Settings > Issue Log Parameters)' })
  async issueLog(@Param('projectId') projectId: string, @CurrentUser() user: User) {
    return this.reportsService.generateIssueLog(projectId, user);
  }

  @Get('history/:projectId')
  @Permission('reports.history')
  @ApiOperation({ summary: 'Get report generation history for a project' })
  async getReportHistory(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
  ) {
    return this.reportsService.getReportHistory(projectId, user);
  }

  @Delete(':id')
  @Permission('reports.delete')
  @ApiOperation({ summary: 'Delete a generated report (project owner or Admin only)' })
  async removeReport(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Req() request: any,
  ) {
    const ipAddress = request.ip || 'unknown';
    const userAgent = request.headers['user-agent'] || 'unknown';
    await this.reportsService.removeReport(id, user, ipAddress, userAgent);
    return { success: true };
  }
}
