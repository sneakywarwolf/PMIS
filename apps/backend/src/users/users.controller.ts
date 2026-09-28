import { Controller, Get, Post, Put, Delete, Body, Param, Req, Res, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { Response } from 'express';
import { UsersService } from './users.service';
import { parseUploadedFileToCsv, UPLOAD_LIMITS } from '../common/bulk-upload-file.util';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateUserDto, UpdateUserDto } from '../auth/dto/auth.dto';
import { User, UserRole } from '@prisma/client';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.AVP, UserRole.TEAM_LEAD)
  @ApiOperation({ summary: 'List users (filtered by role scope)' })
  async findAll(@CurrentUser() user: User) {
    return this.usersService.findAll(user);
  }

  @Get('team-leads')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get all active team leads' })
  async getTeamLeads() {
    return this.usersService.getTeamLeads();
  }

  @Get('managers')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get all active users for manager selection' })
  async getManagers() {
    return this.usersService.getManagers();
  }

  @Get('sample-csv')
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

  @Get('team-hierarchy')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get team hierarchy tree' })
  async getTeamHierarchy() {
    return this.usersService.getTeamHierarchy();
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.AVP, UserRole.TEAM_LEAD)
  @ApiOperation({ summary: 'Get user by ID' })
  async findOne(@Param('id') id: string, @CurrentUser() user: User) {
    return this.usersService.findOne(id, user);
  }

  @Post()
  @Roles(UserRole.ADMIN)
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
  @Roles(UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('file', UPLOAD_LIMITS))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Bulk upload users from a .csv or .xlsx file (Admin only)' })
  async bulkUpload(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: User,
    @Req() req: any,
  ) {
    const csv = await parseUploadedFileToCsv(file);
    const ipAddress = req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    return this.usersService.bulkUpload(csv, user.id, ipAddress, userAgent);
  }

  @Put(':id')
  @Roles(UserRole.ADMIN)
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
  @Roles(UserRole.ADMIN)
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
  @Roles(UserRole.ADMIN)
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
  @Roles(UserRole.ADMIN)
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
