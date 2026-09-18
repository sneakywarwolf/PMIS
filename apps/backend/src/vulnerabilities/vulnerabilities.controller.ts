import { Controller, Get, Post, Put, Delete, Body, Param, Query, Req, Res, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { Response } from 'express';
import { VulnerabilitiesService } from './vulnerabilities.service';
import { parseUploadedFileToCsv } from '../common/bulk-upload-file.util';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User, UserRole } from '@prisma/client';

@ApiTags('Vulnerabilities')
@Controller('vulnerabilities')
export class VulnerabilitiesController {
  constructor(private readonly vulnerabilitiesService: VulnerabilitiesService) {}

  @Get()
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
  @Roles(UserRole.ADMIN, UserRole.AVP, UserRole.TEAM_LEAD)
  @ApiOperation({ summary: 'List pending vulnerability requests' })
  async findPending() {
    return this.vulnerabilitiesService.findPending();
  }

  @Get('severities')
  @ApiOperation({ summary: 'Get all severity counts' })
  async getSeverities() {
    return this.vulnerabilitiesService.getSeverities();
  }

  @Get('export')
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
  @ApiOperation({ summary: 'Download sample CSV format for bulk upload' })
  async getSampleCsv(@Res() response: Response) {
    const csv = this.vulnerabilitiesService.getSampleCsv();
    response.setHeader('Content-Type', 'text/csv');
    response.setHeader('Content-Disposition', 'attachment; filename="vulnerability-sample-format.csv"');
    response.send(csv);
  }

  @Get('change-tracker')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'List all vulnerability changes across the system (Admin only)' })
  async getChangeTracker(@Query('limit') limit?: string) {
    return this.vulnerabilitiesService.getAllHistory(limit ? parseInt(limit) : 100);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get vulnerability by ID' })
  async findOne(@Param('id') id: string) {
    return this.vulnerabilitiesService.findOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create vulnerability entry (Admin)' })
  async create(@Body() body: any, @CurrentUser('id') userId: string) {
    return this.vulnerabilitiesService.create(body, userId);
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'Get audit history for a vulnerability' })
  async getHistory(@Param('id') id: string) {
    return this.vulnerabilitiesService.getHistory(id);
  }

  @Post('request')
  @Roles(UserRole.TESTER, UserRole.TEAM_LEAD, UserRole.ADMIN)
  @ApiOperation({ summary: 'Request new vulnerability (Tester/TL/Admin)' })
  async request(
    @Body() body: any,
    @CurrentUser('id') userId: string,
  ) {
    return this.vulnerabilitiesService.request(body, userId);
  }

  @Post('bulk-upload')
  @Roles(UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Bulk upload vulnerabilities from a .csv or .xlsx file (Admin only)' })
  async bulkUpload(
    @UploadedFile() file: Express.Multer.File,
    @Body('category') category: string,
    @CurrentUser() user: User,
    @Req() req: any,
  ) {
    const csv = await parseUploadedFileToCsv(file);
    const ipAddress = req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    return this.vulnerabilitiesService.bulkUpload(csv, category, user.id, ipAddress, userAgent);
  }

  @Put(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update vulnerability (Admin)' })
  async update(@Param('id') id: string, @Body() body: any, @CurrentUser('id') userId: string) {
    return this.vulnerabilitiesService.update(id, body, userId);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Soft delete vulnerability (Admin)' })
  async remove(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.vulnerabilitiesService.remove(id, userId);
  }

  @Put(':id/approve')
  @Roles(UserRole.ADMIN, UserRole.AVP, UserRole.TEAM_LEAD)
  @ApiOperation({ summary: 'Approve vulnerability request' })
  async approve(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.vulnerabilitiesService.approve(id, userId);
  }

  @Put(':id/reject')
  @Roles(UserRole.ADMIN, UserRole.AVP, UserRole.TEAM_LEAD)
  @ApiOperation({ summary: 'Reject vulnerability request' })
  async reject(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.vulnerabilitiesService.reject(id, userId);
  }
}
