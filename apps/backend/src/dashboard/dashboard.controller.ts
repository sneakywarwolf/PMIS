import { Controller, Get, Query, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

import { User, UserRole } from '@prisma/client';
import { CompletionStatsQueryDto } from './dto/completion-stats-query.dto';
import { Permission } from '../common/permissions';

@ApiTags('Dashboard & Analytics')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('team')
  @Permission('dashboard.team_stats')
  @ApiOperation({ summary: 'Get team statistics for TL dashboard' })
  async getTeamStats(@CurrentUser('id') tlId: string) {
    return this.dashboardService.getTeamStats(tlId);
  }

  @Get('vulnerabilities')
  @ApiOperation({ summary: 'Get vulnerability trends' })
  async getVulnerabilityTrends(@CurrentUser() user: User) {
    return this.dashboardService.getVulnerabilityTrends(user);
  }

  @Get('engagements')
  @ApiOperation({ summary: 'Engagement table rows (team/self view; org-wide for ADMIN/AVP)' })
  async getEngagements(@CurrentUser() user: User, @Query('view') view?: string) {
    return this.dashboardService.getEngagements(user, view === 'self' ? 'self' : 'team');
  }

  @Get('tl-comparison')
  @Permission('dashboard.tl_comparison')
  @ApiOperation({ summary: 'Compare project status and findings across Team Leads (ADMIN/AVP only)' })
  async getTlComparison() {
    return this.dashboardService.getTlComparison();
  }

  @Get('admin')
  @Permission('dashboard.org_stats')
  @ApiOperation({ summary: 'Get global admin statistics' })
  async getAdminStats() {
    return this.dashboardService.getAdminStats();
  }

  @Get('activity')
  @Permission('dashboard.activity_log')
  @ApiOperation({ summary: 'Get recent activity: who did what, with their role (Admin only)' })
  async getRecentActivity(@Query('limit') limit: string, @CurrentUser() user: User) {
    return this.dashboardService.getRecentActivity(Math.min(Math.max(parseInt(limit) || 10, 1), 100), user);
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
