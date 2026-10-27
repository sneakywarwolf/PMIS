import { BadRequestException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QuizService } from '../quiz.service';
import { cleanTeamName } from './team-name';
import { permissionRules } from '../../common/permissions';

export type TeamRow = { teamLeadId: string; name: string; members: number; score: number };

/** Team = a team lead plus the testers assigned to them. Score = average per member, so bigger teams don't win by headcount. */
export function rankTeams(
  teams: { teamLeadId: string; name: string; memberIds: string[] }[],
  points: Map<string, number>,
): TeamRow[] {
  return teams
    .map((t) => ({
      teamLeadId: t.teamLeadId,
      name: t.name,
      members: t.memberIds.length,
      score: Math.round(t.memberIds.reduce((sum, id) => sum + (points.get(id) ?? 0), 0) / t.memberIds.length),
    }))
    .sort((a, b) => b.score - a.score);
}

// Custom names are a Quiz/Arcade-only label; everywhere else in PMIS the team is still just the TL and their testers.
const defaultName = (l: { fullName: string | null; username: string }) => `Team ${l.fullName || l.username}`;

@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService, private readonly quiz: QuizService) {}

  /** Team leads (and admins who have testers assigned) lead a competing team. */
  private async loadTeams() {
    const leads = await this.prisma.user.findMany({
      where: { isActive: true, role: { in: [UserRole.TEAM_LEAD, UserRole.ADMIN] } },
      select: { id: true, role: true, fullName: true, username: true, quizTeamName: true, testers: { where: { isActive: true }, select: { id: true } } },
    });
    // An admin only counts as a team once testers are assigned to them.
    return leads.filter((l) => l.role === UserRole.TEAM_LEAD || l.testers.length > 0).map((l) => ({
      teamLeadId: l.id,
      name: l.quizTeamName || defaultName(l),
      customName: l.quizTeamName,
      memberIds: [l.id, ...l.testers.map((t) => t.id)],
    }));
  }

  async leaderboard(userId: string) {
    const teams = await this.loadTeams();
    const [quizBoard, arcadeBest] = await Promise.all([
      this.quiz.getLeaderboard(),
      this.prisma.patternMapScore.groupBy({ by: ['userId'], _max: { score: true } }),
    ]);
    const quizPoints = new Map(quizBoard.map((e) => [e.userId, e.totalPoints]));
    const arcadePoints = new Map(arcadeBest.map((r) => [r.userId, r._max.score ?? 0]));
    const mine = teams.find((t) => t.memberIds.includes(userId))?.teamLeadId ?? null;
    const tag = (rows: TeamRow[]) => rows.map((r) => ({ ...r, isMine: r.teamLeadId === mine }));

    return { quiz: tag(rankTeams(teams, quizPoints)), arcade: tag(rankTeams(teams, arcadePoints)) };
  }

  /** userId -> team name, so every Quiz/Arcade board can show which team a player belongs to. */
  async names(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const t of await this.loadTeams()) for (const id of t.memberIds) out[id] = t.name;
    return out;
  }

  /** The caller's team (if any) and whether they may rename it. */
  async mine(userId: string, role: UserRole) {
    const team = (await this.loadTeams()).find((t) => t.memberIds.includes(userId));
    return {
      teamName: team?.name ?? null,
      customName: team?.customName ?? null,
      canRename: permissionRules.can(role, 'quiz.rename_team') && team?.teamLeadId === userId,
      // Admins can rename any team (still only a Quiz/Arcade label).
      canRenameAny: role === UserRole.ADMIN,
    };
  }

  /** A team lead renames their own team; an admin names the team of `targetLeadId`. */
  async rename(caller: { id: string; role: UserRole }, raw: unknown, targetLeadId?: string) {
    const leadId = caller.role === UserRole.ADMIN ? targetLeadId : caller.id;
    if (!leadId || !(await this.loadTeams()).some((t) => t.teamLeadId === leadId)) {
      throw new BadRequestException('Choose a team to rename');
    }
    const cleaned = cleanTeamName(raw);
    if ('error' in cleaned) throw new BadRequestException(cleaned.error);

    if (cleaned.name) {
      // Names identify teams on shared boards, so two teams can't use the same one.
      const clash = (await this.loadTeams()).find((t) => t.teamLeadId !== leadId && t.name.toLowerCase() === cleaned.name!.toLowerCase());
      if (clash) throw new BadRequestException('Another team already uses that name');
    }
    await this.prisma.user.update({ where: { id: leadId }, data: { quizTeamName: cleaned.name } });
    return this.mine(caller.id, caller.role);
  }
}
