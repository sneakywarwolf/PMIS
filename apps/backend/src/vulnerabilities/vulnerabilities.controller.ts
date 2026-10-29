import { Controller, Get, Post, Put, Delete, Body, Param, Query, Req, Res, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { Response } from 'express';
import { VulnerabilitiesService } from './vulnerabilities.service';
import { parseUploadedFileToCsv } from '../common/bulk-upload-file.util';
import { AttachmentSizeGuard, assertAttachmentSize, attachmentMulterLimits } from '../common/attachment-upload';
import { attachmentLimits } from '../common/attachment-formats';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User, UserRole } from '@prisma/client';
import { Permission } from '../common/permissions';

@ApiTags('Vulnerabilities')
@Controller('vulnerabilities')
export class VulnerabilitiesController {
  constructor(private readonly vulnerabilitiesService: VulnerabilitiesService) {}

  @Get()
  @Permission('vulns.view')
  @ApiOperation({ summary: 'Search vulnerabilities' })
  async findAll(
    @Query('search') search?: string,
    @Query('severity') severity?: string,
    @Query('category') category?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
    @CurrentUser() user?: User,
  ) {
    return this.vulnerabilitiesService.findAll(search, severity, category, user?.role, sortBy, sortOrder);
  }

  @Get('pending')
  @Permission('vulns.review_requests')
  @ApiOperation({ summary: 'List pending vulnerability requests' })
  async findPending() {
    return this.vulnerabilitiesService.findPending();
  }

  @Get('severities')
  @Permission('vulns.view')
  @ApiOperation({ summary: 'Get all severity counts' })
  async getSeverities() {
    return this.vulnerabilitiesService.getSeverities();
  }

  @Get('export')
  @Permission('vulns.export')
  @ApiOperation({ summary: 'Export vulnerabilities to CSV' })
  async export(
    @Query('severity') severity: string,
    @Res() response: Response,
  ) {
    const csv = await this.vulnerabilitiesService.exportToCsv(severity);
    const filename = severity ? `vulnerabilities-${severity.toLowerCase()}.csv` : 'vulnerabilities-all.csv';

    response.setHeader('Content-Type', 'text/csv');
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    response.send(csv);
  }

  @Get('sample-csv')
  @Permission('vulns.bulk_upload')
  @ApiOperation({ summary: 'Download sample CSV format for bulk upload' })
  async getSampleCsv(@Res() response: Response) {
    const csv = this.vulnerabilitiesService.getSampleCsv();
    response.setHeader('Content-Type', 'text/csv');
    response.setHeader('Content-Disposition', 'attachment; filename="vulnerability-sample-format.csv"');
    response.send(csv);
  }

  @Get('change-tracker')
  @Permission('vulns.change_tracker')
  @ApiOperation({ summary: 'List all vulnerability changes across the system (Admin only)' })
  async getChangeTracker(@Query('limit') limit?: string) {
    return this.vulnerabilitiesService.getAllHistory(limit ? parseInt(limit) : 100);
  }

  @Get(':id')
  @Permission('vulns.view')
  @ApiOperation({ summary: 'Get vulnerability by ID' })
  async findOne(@Param('id') id: string, @CurrentUser() user: User) {
    return this.vulnerabilitiesService.findOne(id, user);
  }

  @Post()
  @Permission('vulns.create')
  @ApiOperation({ summary: 'Create vulnerability entry (Admin)' })
  async create(@Body() body: any, @CurrentUser('id') userId: string) {
    return this.vulnerabilitiesService.create(body, userId);
  }

  @Get(':id/history')
  @Permission('vulns.view')
  @ApiOperation({ summary: 'Get audit history for a vulnerability' })
  async getHistory(@Param('id') id: string, @CurrentUser() user: User) {
    return this.vulnerabilitiesService.getHistory(id, user);
  }

  @Post('request')
  @Permission('vulns.request_new')
  @ApiOperation({ summary: 'Request new vulnerability (Tester/TL/Admin)' })
  async request(
    @Body() body: any,
    @CurrentUser('id') userId: string,
  ) {
    return this.vulnerabilitiesService.request(body, userId);
  }

  @Post('bulk-upload')
  @Permission('vulns.bulk_upload')
  @UseGuards(AttachmentSizeGuard('vulnBulk'))
  @UseInterceptors(FileInterceptor('file', attachmentMulterLimits('vulnBulk')))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Bulk upload vulnerabilities from a .csv or .xlsx file (Admin only)' })
  async bulkUpload(
    @UploadedFile() file: Express.Multer.File,
    @Body('category') category: string,
    @CurrentUser() user: User,
    @Req() req: any,
    @Body('resolutions') resolutions?: string,
    @Body('mode') mode?: string,
  ) {
    assertAttachmentSize('vulnBulk', file);
    const csv = await parseUploadedFileToCsv(file, attachmentLimits.maxBytes('vulnBulk', file?.originalname));
    const ipAddress = req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    let chosen: Record<string, number> = {};
    try {
      const parsed = resolutions ? JSON.parse(resolutions) : {};
      if (parsed && typeof parsed === 'object') chosen = Object.fromEntries(Object.entries(parsed).filter(([, v]) => Number.isInteger(v))) as Record<string, number>;
    } catch {
      throw new BadRequestException('resolutions must be valid JSON.');
    }
    return this.vulnerabilitiesService.bulkUpload(csv, category, user.id, ipAddress, userAgent, chosen, (mode ?? 'REPLACE') as 'REPLACE' | 'MERGE');
  }

  @Put(':id')
  @Permission('vulns.edit')
  @ApiOperation({ summary: 'Update vulnerability (Admin)' })
  async update(@Param('id') id: string, @Body() body: any, @CurrentUser('id') userId: string) {
    return this.vulnerabilitiesService.update(id, body, userId);
  }

  @Post(':id/change-request')
  @Permission('vulns.propose_edit')
  @ApiOperation({ summary: 'Propose an edit to an existing vulnerability (Tester) — requires Admin/TL approval' })
  async createChangeRequest(@Param('id') id: string, @Body() body: any, @CurrentUser('id') userId: string) {
    return this.vulnerabilitiesService.createChangeRequest(id, body, userId);
  }

  @Get('change-requests/pending')
  @Permission('vulns.review_requests')
  @ApiOperation({ summary: 'List pending vulnerability edit requests (scoped to Admin or the requester\'s TL)' })
  async findPendingChangeRequests(@CurrentUser() user: User) {
    return this.vulnerabilitiesService.findPendingChangeRequests(user);
  }

  @Put('change-requests/:id/approve')
  @Permission('vulns.approve_changes')
  @ApiOperation({ summary: 'Approve a pending vulnerability edit request' })
  async approveChangeRequest(@Param('id') id: string, @CurrentUser() user: User) {
    return this.vulnerabilitiesService.approveChangeRequest(id, user);
  }

  @Put('change-requests/:id/reject')
  @Permission('vulns.approve_changes')
  @ApiOperation({ summary: 'Reject a pending vulnerability edit request' })
  async rejectChangeRequest(@Param('id') id: string, @CurrentUser() user: User) {
    return this.vulnerabilitiesService.rejectChangeRequest(id, user);
  }

  @Delete(':id')
  @Permission('vulns.delete')
  @ApiOperation({ summary: 'Soft delete vulnerability (Admin)' })
  async remove(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.vulnerabilitiesService.remove(id, userId);
  }

  @Put(':id/approve')
  @Permission('vulns.approve_requests')
  @ApiOperation({ summary: 'Approve vulnerability request' })
  async approve(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.vulnerabilitiesService.approve(id, userId);
  }

  @Put(':id/reject')
  @Permission('vulns.approve_requests')
  @ApiOperation({ summary: 'Reject vulnerability request' })
  async reject(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.vulnerabilitiesService.reject(id, userId);
  }
}
