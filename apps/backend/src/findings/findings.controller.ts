import { Controller, Get, Post, Put, Delete, Body, Param, Req, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AttachmentSizeGuard, assertAttachmentSize, attachmentMulterLimits } from '../common/attachment-upload';
import { NESSUS_UPLOAD, NessusUploadSizeGuard } from '../common/nessus-upload.storage';
import { FORTIFY_UPLOAD, FortifyUploadSizeGuard } from '../common/fortify-upload';
import { FortifyImportService } from './fortify-import.service';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { Res } from '@nestjs/common';
import type { Response } from 'express';
import { FindingsService } from './findings.service';
import { ProjectFindingsService } from './project-findings.service';
import { StorageService } from '../reports/storage.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '@prisma/client';
import { randomUUID } from 'crypto';
import { sniffImageType } from '../common/upload-security.util';
import { Permission } from '../common/permissions';

@ApiTags('Findings')
@Controller('findings')
export class FindingsController {
  constructor(
    private readonly findingsService: FindingsService,
    private readonly projectFindings: ProjectFindingsService,
    private readonly fortify: FortifyImportService,
    private readonly storageService: StorageService,
  ) {}

  @Post('upload-poc-image')
  @Permission('findings.upload_poc')
  @UseGuards(AttachmentSizeGuard('poc'))
  @UseInterceptors(FileInterceptor('file', attachmentMulterLimits('poc')))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a POC screenshot, returns the storage path for use in a POC step' })
  async uploadPocImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    // Real type comes from the file's magic bytes, not the client-supplied MIME type.
    const type = sniffImageType(file.buffer);
    if (!type) {
      throw new BadRequestException('Only image files (png, jpg, gif, webp) are allowed');
    }
    // The limit is the one set for the image's real format, not for whatever its name says.
    assertAttachmentSize('poc', file, `image.${type === 'image/jpeg' ? 'jpg' : type.slice(6)}`);
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-100);
    const objectName = `poc/${randomUUID()}_${safeName}`;
    await this.storageService.uploadFile(objectName, file.buffer, type);
    return { path: objectName };
  }

  @Post('nessus/preview')
  @Permission('findings.nessus_import')
  @UseGuards(NessusUploadSizeGuard)
  @UseInterceptors(FileInterceptor('file', NESSUS_UPLOAD))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Parse a Nessus .nessus/.csv export and list its findings (no data is written)' })
  async previewNessus(
    @UploadedFile() file: Express.Multer.File,
    @Body('projectId') projectId: string,
    @CurrentUser() user: User,
  ) {
    if (!projectId) throw new BadRequestException('projectId is required');
    return this.findingsService.previewNessus(projectId, file, user);
  }

  @Post('nessus/import')
  @Permission('findings.nessus_import')
  @UseGuards(NessusUploadSizeGuard)
  @UseInterceptors(FileInterceptor('file', NESSUS_UPLOAD))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Import only the selected findings (by Nessus plugin ID) from a Nessus export' })
  async importNessus(
    @UploadedFile() file: Express.Multer.File,
    @Body('projectId') projectId: string,
    @Body('selected') selectedRaw: string,
    @CurrentUser() user: User,
    @Req() request: any,
  ) {
    if (!projectId) throw new BadRequestException('projectId is required');
    let selected: unknown;
    try {
      selected = JSON.parse(selectedRaw);
    } catch {
      selected = null;
    }
    if (!Array.isArray(selected) || !selected.every((k) => typeof k === 'string')) {
      throw new BadRequestException('selected must be a JSON array of plugin IDs');
    }
    const ipAddress = request.ip || 'unknown';
    const userAgent = request.headers['user-agent'] || 'unknown';
    return this.findingsService.importNessus(projectId, file, selected as string[], user, ipAddress, userAgent);
  }

  @Post('fortify/preview')
  @Permission('findings.fortify_import')
  @UseGuards(FortifyUploadSizeGuard)
  @UseInterceptors(FileInterceptor('file', FORTIFY_UPLOAD))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Parse a Fortify .fpr/.xml (FVDL) result file and list its findings (no data is written)' })
  async previewFortify(@UploadedFile() file: Express.Multer.File, @Body('projectId') projectId: string, @CurrentUser() user: User) {
    if (!projectId) throw new BadRequestException('projectId is required');
    return this.fortify.preview(projectId, file, user);
  }

  @Post('fortify/import')
  @Permission('findings.fortify_import')
  @UseGuards(FortifyUploadSizeGuard)
  @UseInterceptors(FileInterceptor('file', FORTIFY_UPLOAD))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Import only the selected findings (by key) from a Fortify result file into an SCR project' })
  async importFortify(
    @UploadedFile() file: Express.Multer.File,
    @Body('projectId') projectId: string,
    @Body('selected') selectedRaw: string,
    @CurrentUser() user: User,
    @Req() request: any,
  ) {
    if (!projectId) throw new BadRequestException('projectId is required');
    let selected: unknown;
    try {
      selected = JSON.parse(selectedRaw);
    } catch {
      selected = null;
    }
    if (!Array.isArray(selected) || !selected.every((k) => typeof k === 'string')) {
      throw new BadRequestException('selected must be a JSON array of finding keys');
    }
    return this.fortify.import(projectId, file, selected as string[], user, request.ip || 'unknown', request.headers['user-agent'] || 'unknown');
  }

  // ─── Project-only findings (not from the Vulnerability DB) ───
  // Declared before the ':id' routes so these paths are never taken for a finding id.

  @Post('manual')
  @Permission('findings.add')
  @ApiOperation({ summary: 'Add a finding by hand. With syncVulnDb (default true) a separate Vulnerability DB approval request is also created' })
  async createManual(@Body() body: any, @CurrentUser() user: User, @Req() request: any) {
    const ipAddress = request.ip || 'unknown';
    const userAgent = request.headers['user-agent'] || 'unknown';
    return this.projectFindings.createManual(body, user, ipAddress, userAgent);
  }

  @Get('import/sample')
  @Permission('findings.file_import')
  @ApiOperation({ summary: 'Sample CSV with the exact headers expected by Import Project Findings' })
  getImportSample(@Res() response: Response) {
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', 'attachment; filename="project-findings-sample.csv"');
    response.send(this.projectFindings.getSampleCsv());
  }

  @Post('import/preview')
  @Permission('findings.file_import')
  @UseGuards(AttachmentSizeGuard('findingsImport'))
  @UseInterceptors(FileInterceptor('file', attachmentMulterLimits('findingsImport')))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Validate a .csv/.xlsx findings file and list what an import would do (nothing is written)' })
  async previewImport(@UploadedFile() file: Express.Multer.File, @Body('projectId') projectId: string, @CurrentUser() user: User) {
    assertAttachmentSize('findingsImport', file);
    return this.projectFindings.previewImport(projectId, file, user);
  }

  @Post('import')
  @Permission('findings.file_import')
  @UseGuards(AttachmentSizeGuard('findingsImport'))
  @UseInterceptors(FileInterceptor('file', attachmentMulterLimits('findingsImport')))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Import project-only findings from a .csv/.xlsx file, all or nothing. Never touches the Vulnerability DB' })
  async importFindings(
    @UploadedFile() file: Express.Multer.File,
    @Body('projectId') projectId: string,
    @CurrentUser() user: User,
    @Req() request: any,
  ) {
    assertAttachmentSize('findingsImport', file);
    const ipAddress = request.ip || 'unknown';
    const userAgent = request.headers['user-agent'] || 'unknown';
    return this.projectFindings.importFindings(projectId, file, user, ipAddress, userAgent);
  }

  @Get('project/:projectId')
  @Permission('findings.view')
  @ApiOperation({ summary: 'Get findings for a project' })
  async findByProject(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
  ) {
    return this.findingsService.findByProject(projectId, user);
  }

  // Declared before the ':id' routes so "project" is never taken for a finding id.
  @Get('project/:projectId/nessus-count')
  @Permission('findings.view')
  @ApiOperation({ summary: 'Number of Nessus-imported VA findings the caller may delete in this project' })
  async countNessus(@Param('projectId') projectId: string, @CurrentUser() user: User) {
    return this.findingsService.countNessusFindings(projectId, user);
  }

  @Get('project/:projectId/fortify-count')
  @Permission('findings.view')
  @ApiOperation({ summary: 'Number of Fortify-imported findings the caller may delete in this project' })
  async countFortify(@Param('projectId') projectId: string, @CurrentUser() user: User) {
    return this.findingsService.countNessusFindings(projectId, user, 'fortify');
  }

  @Delete('project/:projectId/fortify')
  @Permission('findings.fortify_delete_all')
  @ApiOperation({ summary: 'Delete all Fortify-imported findings of a project' })
  async removeAllFortify(@Param('projectId') projectId: string, @CurrentUser() user: User, @Req() request: any) {
    return this.findingsService.removeAllNessusFindings(projectId, user, request.ip || 'unknown', request.headers['user-agent'] || 'unknown', 'fortify');
  }

  @Delete('project/:projectId/nessus')
  @Permission('findings.nessus_delete_all')
  @ApiOperation({ summary: 'Delete all Nessus-imported VA findings of a project' })
  async removeAllNessus(@Param('projectId') projectId: string, @CurrentUser() user: User, @Req() request: any) {
    const ipAddress = request.ip || 'unknown';
    const userAgent = request.headers['user-agent'] || 'unknown';
    return this.findingsService.removeAllNessusFindings(projectId, user, ipAddress, userAgent);
  }

  @Get(':id')
  @Permission('findings.view')
  @ApiOperation({ summary: 'Get finding by ID' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: User,
  ) {
    return this.findingsService.findOne(id, user);
  }

  @Post()
  @Permission('findings.add')
  @ApiOperation({ summary: 'Create a finding' })
  async create(
    @Body() body: {
      projectId: string;
      vulnId: string;
      testerNotes: string;
      evidencePaths?: string[];
      affectedInstances?: string[];
      authenticationType?: string;
      proofOfConcept?: string;
      vulnerabilityDependency?: string;
      reportStatus?: string;
      cvssScoreOverride?: number;
      cvssVectorOverride?: string;
    },
    @CurrentUser() user: User,
    @Req() request: any,
  ) {
    const ipAddress = request.ip || 'unknown';
    const userAgent = request.headers['user-agent'] || 'unknown';
    return this.findingsService.create(body, user, ipAddress, userAgent);
  }

  @Put(':id')
  @Permission('findings.edit')
  @ApiOperation({ summary: 'Update a finding' })
  async update(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentUser() user: User,
    @Req() request: any,
  ) {
    const ipAddress = request.ip || 'unknown';
    const userAgent = request.headers['user-agent'] || 'unknown';
    return this.findingsService.update(id, body, user, ipAddress, userAgent);
  }

  @Delete(':id')
  @Permission('findings.delete')
  @ApiOperation({ summary: 'Delete a finding' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Req() request: any,
  ) {
    const ipAddress = request.ip || 'unknown';
    const userAgent = request.headers['user-agent'] || 'unknown';
    return this.findingsService.remove(id, user, ipAddress, userAgent);
  }

  // POC Steps
  @Post(':id/poc-steps')
  @Permission('findings.edit')
  @ApiOperation({ summary: 'Add POC step to finding' })
  async addPocStep(
    @Param('id') findingId: string,
    @Body() body: { stepNo: number; description: string; imagePath?: string; imagePaths?: string[] },
    @CurrentUser() user: User,
  ) {
    return this.findingsService.addPocStep(findingId, body, user);
  }

  @Put(':id/poc-steps/:stepId')
  @Permission('findings.edit')
  @ApiOperation({ summary: 'Update POC step' })
  async updatePocStep(
    @Param('id') findingId: string,
    @Param('stepId') stepId: string,
    @Body() body: { stepNo?: number; description?: string; imagePath?: string; imagePaths?: string[] },
    @CurrentUser() user: User,
  ) {
    return this.findingsService.updatePocStep(findingId, stepId, body, user);
  }

  @Delete(':id/poc-steps/:stepId')
  @Permission('findings.edit')
  @ApiOperation({ summary: 'Delete POC step' })
  async removePocStep(
    @Param('id') findingId: string,
    @Param('stepId') stepId: string,
    @CurrentUser() user: User,
  ) {
    return this.findingsService.removePocStep(findingId, stepId, user);
  }
}
