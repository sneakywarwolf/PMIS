import { Controller, Get, Post, Put, Delete, Body, Param, Req, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UPLOAD_LIMITS } from '../common/bulk-upload-file.util';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { FindingsService } from './findings.service';
import { StorageService } from '../reports/storage.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '@prisma/client';
import { randomUUID } from 'crypto';

@ApiTags('Findings')
@Controller('findings')
export class FindingsController {
  constructor(
    private readonly findingsService: FindingsService,
    private readonly storageService: StorageService,
  ) {}

  @Post('upload-poc-image')
  @UseInterceptors(FileInterceptor('file', UPLOAD_LIMITS))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a POC screenshot, returns the storage path for use in a POC step' })
  async uploadPocImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException('Only image files (png, jpg, gif, webp) are allowed');
    }
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]+/g, '_');
    const objectName = `poc/${randomUUID()}_${safeName}`;
    await this.storageService.uploadFile(objectName, file.buffer, file.mimetype);
    return { path: objectName };
  }

  @Get('project/:projectId')
  @ApiOperation({ summary: 'Get findings for a project' })
  async findByProject(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
  ) {
    return this.findingsService.findByProject(projectId, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get finding by ID' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: User,
  ) {
    return this.findingsService.findOne(id, user);
  }

  @Post()
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
  @ApiOperation({ summary: 'Add POC step to finding' })
  async addPocStep(
    @Param('id') findingId: string,
    @Body() body: { stepNo: number; description: string; imagePath?: string },
    @CurrentUser() user: User,
  ) {
    return this.findingsService.addPocStep(findingId, body, user);
  }

  @Put(':id/poc-steps/:stepId')
  @ApiOperation({ summary: 'Update POC step' })
  async updatePocStep(
    @Param('id') findingId: string,
    @Param('stepId') stepId: string,
    @Body() body: { stepNo?: number; description?: string; imagePath?: string },
    @CurrentUser() user: User,
  ) {
    return this.findingsService.updatePocStep(findingId, stepId, body, user);
  }

  @Delete(':id/poc-steps/:stepId')
  @ApiOperation({ summary: 'Delete POC step' })
  async removePocStep(
    @Param('id') findingId: string,
    @Param('stepId') stepId: string,
    @CurrentUser() user: User,
  ) {
    return this.findingsService.removePocStep(findingId, stepId, user);
  }
}
