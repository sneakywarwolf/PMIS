import { Controller, Get, Post, Put, Delete, Body, Param, Req, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AttachmentSizeGuard, assertAttachmentSize, attachmentMulterLimits } from '../common/attachment-upload';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateProjectDto, UpdateProjectDto, ReassignProjectDto } from './dto/project.dto';
import { User, UserRole } from '@prisma/client';
import { parseNetworkScopeFile } from '../common/network-scope-import.util';

@ApiTags('Projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  @ApiOperation({ summary: 'List projects (role-filtered)' })
  async findAll(@CurrentUser() user: User) {
    return this.projectsService.findAll(user);
  }

  // Declared before ':id' so "search" isn't treated as a project id.
  @Get('search')
  @ApiOperation({ summary: 'Projects the caller may open, for the Ctrl+K palette' })
  async search(@CurrentUser() user: User) {
    return this.projectsService.searchProjects(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get project by ID' })
  async findOne(@Param('id') id: string, @CurrentUser() user: User) {
    return this.projectsService.findOne(id, user);
  }

  @Post()
  @ApiOperation({ summary: 'Create new project' })
  async create(
    @Body() dto: CreateProjectDto,
    @CurrentUser() user: User,
    @Req() request: any,
  ) {
    const ipAddress = request.ip || 'unknown';
    const userAgent = request.headers['user-agent'] || 'unknown';
    
    // Testers create projects for themselves; TLs/Admin can specify
    const testerId = user.role === UserRole.TESTER ? user.id : user.id;
    const tlId = user.assignedTlId || user.id;
    
    return this.projectsService.create(dto, testerId, tlId, ipAddress, userAgent);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update project' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() user: User,
    @Req() request: any,
  ) {
    const ipAddress = request.ip || 'unknown';
    const userAgent = request.headers['user-agent'] || 'unknown';
    return this.projectsService.update(id, dto, user, ipAddress, userAgent);
  }

  @Post(':id/reassign')
  @Roles(UserRole.TEAM_LEAD, UserRole.AVP, UserRole.ADMIN)
  @ApiOperation({ summary: 'Reassign project to another tester' })
  async reassign(
    @Param('id') id: string,
    @Body() dto: ReassignProjectDto,
    @CurrentUser() user: User,
    @Req() request: any,
  ) {
    const ipAddress = request.ip || 'unknown';
    const userAgent = request.headers['user-agent'] || 'unknown';
    return this.projectsService.reassign(id, dto, user, ipAddress, userAgent);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Permanently delete a project and all related data (Admin only)' })
  async remove(@Param('id') id: string, @CurrentUser('id') adminId: string, @Req() request: any) {
    const ipAddress = request.ip || 'unknown';
    const userAgent = request.headers['user-agent'] || 'unknown';
    return this.projectsService.remove(id, adminId, ipAddress, userAgent);
  }

  // Stateless: validates and returns rows; the caller adds them to its scope table and saves with the project as usual.
  @Post('network-scope/parse')
  @UseGuards(AttachmentSizeGuard('scope'))
  @UseInterceptors(FileInterceptor('file', attachmentMulterLimits('scope')))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Parse a Network Scope import file (.txt, .csv, .xlsx)' })
  async parseNetworkScope(@UploadedFile() file: Express.Multer.File, @Body('existing') existing?: string) {
    assertAttachmentSize('scope', file);
    let current: any[] = [];
    try {
      current = existing ? JSON.parse(existing) : [];
    } catch {
      // unreadable "existing" just means no rows to de-duplicate against
    }
    const rows = (Array.isArray(current) ? current : [])
      .filter((r) => r && typeof r.ip === 'string')
      .map((r) => ({ ip: r.ip, domainHostname: String(r.domainHostname ?? ''), purpose: '' }));
    return parseNetworkScopeFile(file, rows);
  }

  @Post(':id/nmap-import')
  @UseGuards(AttachmentSizeGuard('nmap'))
  @UseInterceptors(FileInterceptor('file', attachmentMulterLimits('nmap')))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Import an Nmap XML port scan into a Network project' })
  async importNmapScan(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: User,
  ) {
    assertAttachmentSize('nmap', file);
    return this.projectsService.importNmapScan(id, file, user);
  }
}
