import { Controller, Get, Post, Put, Delete, Body, Param, Req, UseInterceptors, UploadedFile, Query, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { User, UserRole, TemplateCategory, TemplateSubType } from '@prisma/client';

@ApiTags('Reports & Templates')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  // Template Management
  @Post('templates')
  @Roles(UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload report template with field extraction' })
  async uploadTemplate(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: {
      name: string;
      category: TemplateCategory;
      subType: TemplateSubType;
      effectiveFrom: string;
      effectiveTo?: string;
    },
    @CurrentUser('id') adminId: string,
    @Req() request: any,
  ) {
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
    );
  }

  @Get('templates')
  @ApiOperation({ summary: 'List active templates with optional filtering' })
  async getTemplates(
    @Query('category') category?: TemplateCategory,
    @Query('subType') subType?: TemplateSubType,
  ) {
    return this.reportsService.getTemplates(category, subType);
  }

  @Get('templates/all')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'List all templates including inactive drafts (admin)' })
  async getAllTemplates(
    @Query('category') category?: TemplateCategory,
    @Query('subType') subType?: TemplateSubType,
  ) {
    return this.reportsService.getTemplates(category, subType, true);
  }

  @Post('templates/:id/fields')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Manually add a field the extractor missed' })
  async addTemplateField(
    @Param('id') id: string,
    @Body() body: { name: string; normalizedName: string; category: string; description?: string },
    @CurrentUser('id') adminId: string,
  ) {
    return this.reportsService.addTemplateField(id, body, adminId);
  }

  @Put('templates/fields/:fieldId')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Edit a template field label/category/description/parameter mapping' })
  async updateTemplateField(
    @Param('fieldId') fieldId: string,
    @Body() body: { name?: string; category?: string; description?: string; mappedParameter?: string | null },
  ) {
    return this.reportsService.updateTemplateField(fieldId, body);
  }

  @Get('templates/parameters')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'List canonical application parameters a template field can be mapped to' })
  getTemplateParameters() {
    return this.reportsService.getTemplateParameters();
  }

  @Get('templates/:id/fields')
  @ApiOperation({ summary: 'Get extracted fields for a template' })
  async getTemplateFields(@Param('id') id: string) {
    return this.reportsService.getTemplateFields(id);
  }

  @Put('templates/:id/activate')
  @Roles(UserRole.ADMIN)
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
  @Roles(UserRole.ADMIN)
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

  // Report Generation
  @Post('generate')
  @ApiOperation({ summary: 'Generate report — all data pulled automatically from project, profiles and findings' })
  async generateReport(
    @Body() body: { projectId: string },
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
    );
  }

  @Get('generate/:id/status')
  @ApiOperation({ summary: 'Poll a queued/in-progress report generation for completion' })
  async getGenerationStatus(@Param('id') id: string, @CurrentUser() user: User) {
    return this.reportsService.getReportGenerationStatus(id, user);
  }

  @Get('preflight/:projectId')
  @ApiOperation({ summary: 'Pre-generation completeness check (missing data report)' })
  async preflight(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
  ) {
    return this.reportsService.preflight(projectId, user);
  }

  @Get('history/:projectId')
  @ApiOperation({ summary: 'Get report generation history for a project' })
  async getReportHistory(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
  ) {
    return this.reportsService.getReportHistory(projectId, user);
  }

  @Delete(':id')
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
