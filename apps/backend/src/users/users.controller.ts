import { Controller, Get, Post, Put, Delete, Body, Param, Req, Res, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { Response } from 'express';
import { UsersService } from './users.service';
import { parseUploadedFileToCsv } from '../common/bulk-upload-file.util';
import { AttachmentSizeGuard, assertAttachmentSize, attachmentMulterLimits } from '../common/attachment-upload';
import { attachmentLimits } from '../common/attachment-formats';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

import { CreateUserDto, UpdateUserDto } from '../auth/dto/auth.dto';
import { User, UserRole } from '@prisma/client';
import { Permission } from '../common/permissions';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Permission('users.list')
  @ApiOperation({ summary: 'List users (filtered by role scope)' })
  async findAll(@CurrentUser() user: User) {
    return this.usersService.findAll(user);
  }

  @Get('team-leads')
  @Permission('users.hierarchy')
  @ApiOperation({ summary: 'Get all active team leads' })
  async getTeamLeads() {
    return this.usersService.getTeamLeads();
  }

  @Get('managers')
  @Permission('users.hierarchy')
  @ApiOperation({ summary: 'Get all active users for manager selection' })
  async getManagers() {
    return this.usersService.getManagers();
  }

  @Get('sample-csv')
  @Permission('users.bulk_import')
  @ApiOperation({ summary: 'Download sample CSV format for bulk user upload' })
  async getSampleCsv(@Res() response: Response) {
    const csv = this.usersService.getSampleCsv();
    response.setHeader('Content-Type', 'text/csv');
    response.setHeader('Content-Disposition', 'attachment; filename="user-sample-format.csv"');
    response.send(csv);
  }

  @Get('profile')
  @ApiOperation({ summary: 'Get current user profile' })
  async getProfile(@CurrentUser('id') userId: string) {
    return this.usersService.getProfile(userId);
  }

  @Put('profile')
  @ApiOperation({ summary: 'Update current user profile' })
  async updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: { fullName?: string; phone?: string; designation?: string },
  ) {
    return this.usersService.updateProfile(userId, dto);
  }

  // Open to every role (scoped to the caller's own team in the service). Declared before ':id'.
  @Get('my-team')
  @ApiOperation({ summary: "The caller's own team: lead, manager and members (names only)" })
  getMyTeam(@CurrentUser() user: User) {
    return this.usersService.getMyTeam(user);
  }

  @Get('team-hierarchy')
  @Permission('users.hierarchy')
  @ApiOperation({ summary: 'Get team hierarchy tree' })
  async getTeamHierarchy() {
    return this.usersService.getTeamHierarchy();
  }

  @Get(':id')
  @Permission('users.list')
  @ApiOperation({ summary: 'Get user by ID' })
  async findOne(@Param('id') id: string, @CurrentUser() user: User) {
    return this.usersService.findOne(id, user);
  }

  @Post()
  @Permission('users.create')
  @ApiOperation({ summary: 'Create new user' })
  async create(
    @Body() dto: CreateUserDto,
    @CurrentUser('id') adminId: string,
    @Req() request: any,
  ) {
    const ipAddress = request.ip || 'unknown';
    const userAgent = request.headers['user-agent'] || 'unknown';
    return this.usersService.create(dto, adminId, ipAddress, userAgent);
  }

  @Post('bulk-upload')
  @Permission('users.bulk_import')
  @UseGuards(AttachmentSizeGuard('userBulk'))
  @UseInterceptors(FileInterceptor('file', attachmentMulterLimits('userBulk')))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Bulk upload users from a .csv or .xlsx file (Admin only)' })
  async bulkUpload(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: User,
    @Req() req: any,
  ) {
    assertAttachmentSize('userBulk', file);
    const csv = await parseUploadedFileToCsv(file, attachmentLimits.maxBytes('userBulk', file?.originalname));
    const ipAddress = req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    return this.usersService.bulkUpload(csv, user.id, ipAddress, userAgent);
  }

  @Put(':id')
  @Permission('users.edit')
  @ApiOperation({ summary: 'Update user' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser('id') adminId: string,
    @Req() request: any,
  ) {
    const ipAddress = request.ip || 'unknown';
    const userAgent = request.headers['user-agent'] || 'unknown';
    return this.usersService.update(id, dto, adminId, ipAddress, userAgent);
  }

  @Put(':id/activate')
  @Permission('users.activate')
  @ApiOperation({ summary: 'Activate deactivated user' })
  async activate(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
    @Req() request: any,
  ) {
    const ipAddress = request.ip || 'unknown';
    const userAgent = request.headers['user-agent'] || 'unknown';
    return this.usersService.update(id, { isActive: true }, adminId, ipAddress, userAgent);
  }

  @Post(':id/reset-password')
  @Permission('users.reset_password')
  @ApiOperation({ summary: 'Force password reset' })
  async forcePasswordReset(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
    @Req() request: any,
  ) {
    const ipAddress = request.ip || 'unknown';
    const userAgent = request.headers['user-agent'] || 'unknown';
    return this.usersService.forcePasswordReset(id, adminId, ipAddress, userAgent);
  }

  @Delete(':id')
  @Permission('users.deactivate')
  @ApiOperation({ summary: 'Deactivate user with a 24h grace period; reactivating within the window restores the user with data intact, otherwise owned project data/files are purged' })
  async softDelete(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
    @Req() request: any,
  ) {
    const ipAddress = request.ip || 'unknown';
    const userAgent = request.headers['user-agent'] || 'unknown';
    return this.usersService.softDelete(id, adminId, ipAddress, userAgent);
  }
}
