import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SubmitPatternMapDto } from './arcade.dto';
import { scoreRun } from './pattern-map.score';

@Injectable()
export class ArcadeService {
  constructor(private readonly prisma: PrismaService) {}

  async submit(userId: string, dto: SubmitPatternMapDto) {
    const result = scoreRun(dto.rounds, dto.clicks, dto.correctClicks);
    if (!result) throw new BadRequestException('Invalid game run');
    const saved = await this.prisma.patternMapScore.create({
      data: { userId, score: result.score, accuracy: result.accuracy, roundsCleared: dto.rounds.length },
    });
    const best = await this.prisma.patternMapScore.aggregate({ where: { userId }, _max: { score: true } });
    return { score: saved.score, accuracy: saved.accuracy, roundsCleared: saved.roundsCleared, best: best._max.score ?? saved.score };
  }

  /** Everyone vs everyone: best score per active player, top 50. */
  async leaderboard() {
    const rows = await this.prisma.patternMapScore.groupBy({
      by: ['userId'],
      where: { user: { isActive: true } },
      _max: { score: true },
      orderBy: { _max: { score: 'desc' } },
      take: 50,
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.userId) } },
      select: { id: true, fullName: true, username: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.map((r, i) => ({
      rank: i + 1,
      userId: r.userId,
      name: byId.get(r.userId)?.fullName || byId.get(r.userId)?.username || 'Unknown',
      bestScore: r._max.score ?? 0,
    }));
  }
}
