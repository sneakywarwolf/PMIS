import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { User, UserRole, ProjectStatus } from '@prisma/client';
import { buildCompletionStats, CompletedProjectRow, CompletionStatsBase } from './completion-stats.util';
import { ComplianceType } from '@prisma/client';
import { CompletionStatsGranularity } from './dto/completion-stats-query.dto';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  private readonly completedProjectSelect = {
    id: true,
    name: true,
    complianceType: true,
    endDate: true,
  } as const;

  async getSelfCompletionStats(userId: string, granularity: CompletionStatsGranularity) {
    const rows = await this.prisma.project.findMany({
      where: { testerId: userId, status: ProjectStatus.COMPLETED },
      select: this.completedProjectSelect,
    });
    return buildCompletionStats(rows as CompletedProjectRow[], granularity);
  }

  async getTeamCompletionStats(
    tlId: string,
    granularity: CompletionStatsGranularity,
    includeMembers: boolean,
  ): Promise<CompletionStatsBase & { members?: Array<{ id: string; username: string; totalCompleted: number; byType: Record<ComplianceType, number> }> }> {
    const tl = await this.prisma.user.findUnique({ where: { id: tlId } });
    if (!tl || tl.role !== UserRole.TEAM_LEAD) {
      const empty = buildCompletionStats([], granularity);
      return includeMembers ? { ...empty, members: [] } : empty;
    }

    const testers = await this.prisma.user.findMany({
      where: { assignedTlId: tlId, isActive: true },
      select: { id: true, username: true },
    });
    const testerIds = testers.map((t) => t.id);

    const rows = await this.prisma.project.findMany({
      where: {
        status: ProjectStatus.COMPLETED,
        OR: [{ tlId }, { testerId: { in: testerIds } }],
      },
      select: { ...this.completedProjectSelect, testerId: true },
    });

    const base = buildCompletionStats(rows as CompletedProjectRow[], granularity);
    if (!includeMembers) {
      return base;
    }

    const members = testers.map((tester) => {
      const testerRows = rows.filter((r) => r.testerId === tester.id) as CompletedProjectRow[];
      const memberStats = buildCompletionStats(testerRows, granularity);
      return {
        id: tester.id,
        username: tester.username,
        totalCompleted: memberStats.totalCompleted,
        byType: memberStats.byType,
      };
    });

    return { ...base, members };
  }

  async getOrgCompletionStats(
    granularity: CompletionStatsGranularity,
  ): Promise<CompletionStatsBase & { teams: Array<{ tlId: string; tlName: string; teamSize: number; totalCompleted: number; byType: Record<ComplianceType, number> }> }> {
    const rows = await this.prisma.project.findMany({
      where: { status: ProjectStatus.COMPLETED },
      select: { ...this.completedProjectSelect, tlId: true, testerId: true },
    });
    const base = buildCompletionStats(rows as CompletedProjectRow[], granularity);

    const teamLeads = await this.prisma.user.findMany({
      where: { role: UserRole.TEAM_LEAD, isActive: true },
      select: { id: true, username: true },
    });

    const teams = await Promise.all(
      teamLeads.map(async (tl) => {
        const testers = await this.prisma.user.findMany({
          where: { assignedTlId: tl.id, isActive: true },
          select: { id: true },
        });
        const teamRows = rows.filter(
          (r: any) => r.tlId === tl.id || testers.some((t) => t.id === r.testerId),
        ) as CompletedProjectRow[];
        const teamStats = buildCompletionStats(teamRows, granularity);
        return {
          tlId: tl.id,
          tlName: tl.username,
          teamSize: testers.length,
          totalCompleted: teamStats.totalCompleted,
          byType: teamStats.byType,
        };
      }),
    );

    return { ...base, teams };
  }

  async getTeamStats(tlId: string) {
    // Get all testers under this TL
    const testers = await this.prisma.user.findMany({
      where: { assignedTlId: tlId, isActive: true },
      select: { id: true, username: true },
    });

    const testerIds = testers.map(t => t.id);
    
    const projects = await this.prisma.project.findMany({
      where: {
        OR: [
          { tlId },
          { testerId: { in: testerIds } },
        ],
      },
    });

    const projectStats = {
      total: projects.length,
      notStarted: projects.filter(p => p.status === 'NOT_STARTED').length,
      inProgress: projects.filter(p => p.status === 'IN_PROGRESS').length,
      awaitingReview: projects.filter(p => p.status === 'AWAITING_REVIEW').length,
      completed: projects.filter(p => p.status === 'COMPLETED').length,
    };

    // Tester productivity
    const testerStats = await Promise.all(
      testers.map(async (tester) => {
        const testerProjects = projects.filter(p => p.testerId === tester.id);
        const findings = await this.prisma.finding.count({
          where: { createdById: tester.id },
        });
        
        return {
          id: tester.id,
          username: tester.username,
          activeProjects: testerProjects.filter(p => p.status === 'IN_PROGRESS').length,
          completedProjects: testerProjects.filter(p => p.status === 'COMPLETED').length,
          pendingReviews: testerProjects.filter(p => p.status === 'AWAITING_REVIEW').length,
          totalFindings: findings,
        };
      }),
    );

    return { projectStats, testerStats };
  }

  async getVulnerabilityTrends(user: User) {
    const where: any = {};
    
    if (user.role === UserRole.TESTER) {
      where.createdById = user.id;
    } else if (user.role === UserRole.TEAM_LEAD || user.role === UserRole.AVP) {
      const testers = await this.prisma.user.findMany({
        where: { assignedTlId: user.id },
        select: { id: true },
      });
      where.createdById = { in: testers.map(t => t.id) };
    }

    const findings = await this.prisma.finding.findMany({
      where,
      include: { vulnerability: true },
    });

    // Group by severity
    const bySeverity = findings.reduce((acc: any, f) => {
      const sev = f.vulnerability.severity;
      acc[sev] = (acc[sev] || 0) + 1;
      return acc;
    }, {});

    return { bySeverity, total: findings.length };
  }

  async getAdminStats() {
    const [
      totalUsers,
      activeUsers,
      totalProjects,
      totalFindings,
      totalTemplates,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.project.count(),
      this.prisma.finding.count(),
      this.prisma.reportTemplate.count(),
    ]);

    const projectsByStatus = await this.prisma.project.groupBy({
      by: ['status'],
      _count: { status: true },
    });

    return {
      users: { total: totalUsers, active: activeUsers },
      projects: { total: totalProjects, byStatus: projectsByStatus },
      findings: totalFindings,
      templates: totalTemplates,
    };
  }

  async getRecentActivity(limit: number = 10) {
    return this.prisma.auditLog.findMany({
      take: limit,
      orderBy: { timestamp: 'desc' },
      include: {
        actor: {
          select: { id: true, username: true, role: true },
        },
      },
    });
  }
}
