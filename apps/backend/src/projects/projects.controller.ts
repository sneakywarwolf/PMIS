import { Controller, Get, Post, Put, Body, Param, Req } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateProjectDto, UpdateProjectDto, ReassignProjectDto, ReviewProjectDto } from './dto/project.dto';
import { User, UserRole } from '@prisma/client';

@ApiTags('Projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  @ApiOperation({ summary: 'List projects (role-filtered)' })
  async findAll(@CurrentUser() user: User) {
    return this.projectsService.findAll(user);
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
    @CurrentUser('id') tlId: string,
    @Req() request: any,
  ) {
    const ipAddress = request.ip || 'unknown';
    const userAgent = request.headers['user-agent'] || 'unknown';
    return this.projectsService.reassign(id, dto, tlId, ipAddress, userAgent);
  }

  @Post(':id/review')
  @Roles(UserRole.TEAM_LEAD, UserRole.AVP, UserRole.ADMIN)
  @ApiOperation({ summary: 'Review and approve/reject project' })
  async review(
    @Param('id') id: string,
    @Body() dto: ReviewProjectDto,
    @CurrentUser('id') tlId: string,
    @Req() request: any,
  ) {
    const ipAddress = request.ip || 'unknown';
    const userAgent = request.headers['user-agent'] || 'unknown';
    return this.projectsService.review(id, dto, tlId, ipAddress, userAgent);
  }
}
