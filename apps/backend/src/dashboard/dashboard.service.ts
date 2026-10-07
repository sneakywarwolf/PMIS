import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { User, UserRole, ProjectStatus } from '@prisma/client';
import { buildCompletionStats, CompletionStatsBase, isCompletedProjectRow } from './completion-stats.util';
import { ComplianceType } from '@prisma/client';
import { CompletionStatsGranularity } from './dto/completion-stats-query.dto';

// Vulnerability.severity is a free-form string; fold "Informational"/"Info" together.
function severityKey(raw: string): 'critical' | 'high' | 'medium' | 'low' | 'info' {
  const s = raw.trim().toLowerCase();
  return s === 'critical' || s === 'high' || s === 'medium' || s === 'low' ? s : 'info';
}

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  private readonly completedProjectSelect = {
    id: true,
    name: true,
    complianceType: true,
    endDate: true,
  } as const;

  // Completed projects always carry an endDate/complianceType in practice, but the
  // schema allows null; excluding null rows at the DB level keeps corrupt/incomplete
  // records out of the stats instead of crashing or polluting byType.
  private readonly completedProjectWhere = {
    endDate: { not: null },
    complianceType: { not: null },
  } as const;

  async getSelfCompletionStats(userId: string, granularity: CompletionStatsGranularity) {
    const rows = await this.prisma.project.findMany({
      where: { testerId: userId, status: ProjectStatus.COMPLETED, ...this.completedProjectWhere },
      select: this.completedProjectSelect,
    });
    return buildCompletionStats(rows.filter(isCompletedProjectRow), granularity);
  }

  async getTeamCompletionStats(
    tlId: string,
    granularity: CompletionStatsGranularity,
    includeMembers: boolean,
  ): Promise<CompletionStatsBase & { members?: Array<{ id: string; username: string; totalCompleted: number; byType: Record<ComplianceType, number> }> }> {
    const tl = await this.prisma.user.findUnique({ where: { id: tlId } });
    if (!tl || (tl.role !== UserRole.TEAM_LEAD && tl.role !== UserRole.ADMIN)) {
      const empty = buildCompletionStats([], granularity);
      return includeMembers ? { ...empty, members: [] } : empty;
    }

    const testers = await this.prisma.user.findMany({
      where: { assignedTlId: tlId, isActive: true },
      select: { id: true, username: true },
    });
    const testerIds = testers.map((t) => t.id);

    // Broad candidate fetch: a project may belong to this team either via its own
    // (possibly stale) tlId or via a tester currently on this team. Ownership is
    // resolved below, same as getOrgCompletionStats, so a project whose tester has
    // since moved to another team isn't double-counted across team/org views.
    const candidateRows = await this.prisma.project.findMany({
      where: {
        status: ProjectStatus.COMPLETED,
        ...this.completedProjectWhere,
        OR: [{ tlId }, { testerId: { in: testerIds } }],
      },
      select: { ...this.completedProjectSelect, tlId: true, testerId: true },
    });

    const candidateTesterIds = [...new Set(candidateRows.map((r) => r.testerId))];
    const candidateTesters = await this.prisma.user.findMany({
      where: { id: { in: candidateTesterIds } },
      select: { id: true, assignedTlId: true },
    });
    const testerToTl = new Map(candidateTesters.map((t) => [t.id, t.assignedTlId]));
    const owningTlId = (r: { testerId: string; tlId: string }) => testerToTl.get(r.testerId) ?? r.tlId;

    const rows = candidateRows.filter((r) => owningTlId(r) === tlId).filter(isCompletedProjectRow);

    const base = buildCompletionStats(rows, granularity);
    if (!includeMembers) {
      return base;
    }

    const members = testers.map((tester) => {
      const testerRows = rows.filter((r) => r.testerId === tester.id);
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
    const rawRows = await this.prisma.project.findMany({
      where: { status: ProjectStatus.COMPLETED, ...this.completedProjectWhere },
      select: { ...this.completedProjectSelect, tlId: true, testerId: true },
    });
    const rows = rawRows.filter(isCompletedProjectRow);
    const base = buildCompletionStats(rows, granularity);

    const teamLeads = await this.prisma.user.findMany({
      where: { role: UserRole.TEAM_LEAD, isActive: true },
      select: { id: true, username: true },
    });

    // All active testers with a current team assignment, fetched once and reused
    // both for teamSize and to resolve each project's owning team below.
    const allTesters = await this.prisma.user.findMany({
      where: { assignedTlId: { not: null }, isActive: true },
      select: { id: true, assignedTlId: true },
    });
    const testerToTl = new Map(allTesters.map((t) => [t.id, t.assignedTlId as string]));

    // A project belongs to exactly one team: the tester's *current* team if known,
    // else the project's own (possibly stale) tlId. Prevents double-counting when
    // a tester has since moved teams.
    const owningTlId = (r: any) => testerToTl.get(r.testerId) ?? r.tlId;

    const teams = teamLeads.map((tl) => {
      const teamSize = allTesters.filter((t) => t.assignedTlId === tl.id).length;
      const teamRows = rows.filter((r) => owningTlId(r) === tl.id);
      const teamStats = buildCompletionStats(teamRows, granularity);
      return {
        tlId: tl.id,
        tlName: tl.username,
        teamSize,
        totalCompleted: teamStats.totalCompleted,
        byType: teamStats.byType,
      };
    });

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

  /**
   * Engagement rows for the dashboard table. ADMIN/AVP see every team's
   * projects; TESTER/TEAM_LEAD get `team` (their TL's whole team) or `self`.
   */
  async getEngagements(user: Pick<User, 'id' | 'role' | 'assignedTlId'>, view: 'team' | 'self') {
    const isOrgWide = user.role === UserRole.ADMIN || user.role === UserRole.AVP;
    let where: any = {};

    if (!isOrgWide) {
      if (view === 'self') {
        where = { OR: [{ testerId: user.id }, { tlId: user.id }] };
      } else {
        const tlId = user.role === UserRole.TEAM_LEAD ? user.id : user.assignedTlId;
        if (!tlId) {
          where = { testerId: user.id };
        } else {
          // A project belongs to its tester's *current* team (same ownership rule as the TL comparison),
          // so a project doesn't stay visible to its old TL's team after the tester moves, and
          // testers never see another team's projects. The lead's own testing work counts as theirs.
          // Only a lead also keeps projects they're the stored TL of whose tester isn't on any team yet;
          // a tester sees work carried by members of their team and nothing else.
          where = {
            OR: [
              { tester: { assignedTlId: tlId } },
              { testerId: tlId },
              ...(user.role === UserRole.TESTER ? [] : [{ tlId, tester: { assignedTlId: null } }]),
            ],
          };
        }
      }
    }

    const projects = await this.prisma.project.findMany({
      where,
      orderBy: { startDate: 'desc' },
      select: {
        id: true,
        name: true,
        clientName: true,
        scope: true,
        totalScopeCount: true,
        testingType: true,
        subType: true,
        complianceType: true,
        status: true,
        startDate: true,
        endDate: true,
        tester: { select: { id: true, username: true, fullName: true, assignedTlId: true, assignedTl: { select: { id: true, username: true, fullName: true } } } },
        tl: { select: { id: true, username: true, fullName: true } },
      },
    });

    const findings = projects.length
      ? await this.prisma.finding.findMany({
          where: { projectId: { in: projects.map((p) => p.id) } },
          select: { projectId: true, vulnerability: { select: { severity: true } } },
        })
      : [];

    const counts = new Map<string, Record<string, number>>();
    for (const f of findings) {
      const sev = severityKey(f.vulnerability.severity);
      const row = counts.get(f.projectId) ?? { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
      row[sev] += 1;
      counts.set(f.projectId, row);
    }

    // The Team Lead shown is the tester's *current* lead (that's what decides which team the project
    // belongs to and who can see it). The stored project.tl is only a fallback for testers with no
    // lead, e.g. a lead working their own project.
    return projects.map(({ tester, ...p }) => ({
      ...p,
      tester: { id: tester.id, username: tester.username, fullName: tester.fullName, assignedTlId: tester.assignedTlId },
      tl: tester.assignedTl ?? p.tl,
      vulnCounts: counts.get(p.id) ?? { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    }));
  }

  /**
   * Per-Team-Lead status comparison (ADMIN/AVP only — enforced on the controller).
   * A project belongs to its tester's *current* TL, falling back to the project's
   * own tlId, same ownership rule as getOrgCompletionStats (no double-counting
   * after a tester moves teams).
   */
  async getTlComparison() {
    const [tls, testers, projects, findings] = await Promise.all([
      this.prisma.user.findMany({
        where: { role: UserRole.TEAM_LEAD, isActive: true },
        select: { id: true, username: true, fullName: true },
      }),
      this.prisma.user.findMany({ select: { id: true, assignedTlId: true } }),
      this.prisma.project.findMany({ select: { id: true, status: true, testerId: true, tlId: true } }),
      // ponytail: loads every finding to bucket severity (it's a relation field, so no groupBy);
      // move to a raw SQL aggregate if the findings table gets large.
      this.prisma.finding.findMany({ select: { projectId: true, vulnerability: { select: { severity: true } } } }),
    ]);

    const testerToTl = new Map(testers.map((t) => [t.id, t.assignedTlId]));
    const empty = () => ({ critical: 0, high: 0, medium: 0, low: 0, info: 0 });
    const teams = new Map(
      tls.map((tl) => [
        tl.id,
        {
          tlId: tl.id,
          tlName: tl.fullName || tl.username,
          teamSize: testers.filter((t) => t.assignedTlId === tl.id).length,
          total: 0,
          byStatus: { NOT_STARTED: 0, IN_PROGRESS: 0, AWAITING_REVIEW: 0, COMPLETED: 0 } as Record<string, number>,
          vulnCounts: empty() as Record<string, number>,
        },
      ]),
    );

    const owner = new Map<string, string>();
    for (const p of projects) {
      const team = teams.get(testerToTl.get(p.testerId) ?? p.tlId);
      if (!team) continue;
      owner.set(p.id, team.tlId);
      team.total += 1;
      if (p.status in team.byStatus) team.byStatus[p.status] += 1;
    }
    for (const f of findings) {
      const team = teams.get(owner.get(f.projectId) ?? '');
      if (team) team.vulnCounts[severityKey(f.vulnerability.severity)] += 1;
    }

    return [...teams.values()].sort((a, b) => a.tlName.localeCompare(b.tlName));
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
