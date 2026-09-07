import { Controller, Get, Query, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { User, UserRole } from '@prisma/client';
import { CompletionStatsQueryDto } from './dto/completion-stats-query.dto';

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

  @Get('completion-stats')
  @ApiOperation({ summary: 'Get Projects Completed stats (self/team/org scope) by compliance type' })
  async getCompletionStats(@Query() query: CompletionStatsQueryDto, @CurrentUser() user: User) {
    const { scope, granularity, tlId } = query;

    if (scope === 'org') {
      if (user.role !== UserRole.ADMIN && user.role !== UserRole.AVP) {
        throw new ForbiddenException('Access denied. Required role: ADMIN or AVP');
      }
      return this.dashboardService.getOrgCompletionStats(granularity);
    }

    if (scope === 'team') {
      const ownTlId = user.role === UserRole.TEAM_LEAD ? user.id : (user as any).assignedTlId;
      if (tlId && tlId !== ownTlId) {
        return this.dashboardService.getTeamCompletionStats(tlId, granularity, false);
      }
      if (!ownTlId) {
        return this.dashboardService.getTeamCompletionStats('__none__', granularity, true);
      }
      return this.dashboardService.getTeamCompletionStats(ownTlId, granularity, true);
    }

    return this.dashboardService.getSelfCompletionStats(user.id, granularity);
  }
}
