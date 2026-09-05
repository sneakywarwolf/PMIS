import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { User, UserRole } from '@prisma/client';

@ApiTags('Dashboard & Analytics')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('team')
  @Roles(UserRole.TEAM_LEAD, UserRole.AVP, UserRole.ADMIN)
  @ApiOperation({ summary: 'Get team statistics for TL dashboard' })
  async getTeamStats(@CurrentUser('id') tlId: string) {
    return this.dashboardService.getTeamStats(tlId);
  }

  @Get('vulnerabilities')
  @ApiOperation({ summary: 'Get vulnerability trends' })
  async getVulnerabilityTrends(@CurrentUser() user: User) {
    return this.dashboardService.getVulnerabilityTrends(user);
  }

  @Get('admin')
  @Roles(UserRole.ADMIN, UserRole.AVP)
  @ApiOperation({ summary: 'Get global admin statistics' })
  async getAdminStats() {
    return this.dashboardService.getAdminStats();
  }

  @Get('activity')
  @Roles(UserRole.ADMIN, UserRole.AVP, UserRole.TEAM_LEAD)
  @ApiOperation({ summary: 'Get recent activity' })
  async getRecentActivity(@Query('limit') limit: string) {
    return this.dashboardService.getRecentActivity(parseInt(limit) || 10);
  }
}
