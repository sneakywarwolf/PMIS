import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QuizService } from '../quiz.service';

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

@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService, private readonly quiz: QuizService) {}

  async leaderboard() {
    const leads = await this.prisma.user.findMany({
      where: { isActive: true, role: { in: [UserRole.TEAM_LEAD, UserRole.AVP] } },
      select: { id: true, fullName: true, username: true, testers: { where: { isActive: true }, select: { id: true } } },
    });
    const teams = leads.map((l) => ({
      teamLeadId: l.id,
      name: `Team ${l.fullName || l.username}`,
      memberIds: [l.id, ...l.testers.map((t) => t.id)],
    }));

    const [quizBoard, arcadeBest] = await Promise.all([
      this.quiz.getLeaderboard(),
      this.prisma.patternMapScore.groupBy({ by: ['userId'], _max: { score: true } }),
    ]);
    const quizPoints = new Map(quizBoard.map((e) => [e.userId, e.totalPoints]));
    const arcadePoints = new Map(arcadeBest.map((r) => [r.userId, r._max.score ?? 0]));

    return { quiz: rankTeams(teams, quizPoints), arcade: rankTeams(teams, arcadePoints) };
  }
}
