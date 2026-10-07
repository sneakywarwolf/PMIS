import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SubmitPatternMapDto } from './arcade.dto';
import { scoreRun } from './pattern-map.score';

// A real run (reveal + recall of even one round) takes longer than this, so
// faster repeat submissions are scripted/replayed rather than played.
export const MIN_SECONDS_BETWEEN_SCORES = 10;

/** Monday 00:00 UTC of the current week. */
export function startOfWeek(now = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}

@Injectable()
export class ArcadeService {
  constructor(private readonly prisma: PrismaService) {}

  async submit(userId: string, dto: SubmitPatternMapDto) {
    const result = scoreRun(dto.rounds, dto.clicks, dto.correctClicks);
    if (!result) throw new BadRequestException('Invalid game run');

    const last = await this.prisma.patternMapScore.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
    if (last && Date.now() - last.createdAt.getTime() < MIN_SECONDS_BETWEEN_SCORES * 1000) {
      throw new HttpException('Scores are being submitted too quickly', HttpStatus.TOO_MANY_REQUESTS);
    }

    const saved = await this.prisma.patternMapScore.create({
      data: { userId, score: result.score, accuracy: result.accuracy, roundsCleared: dto.rounds.length },
    });
    const best = await this.prisma.patternMapScore.aggregate({ where: { userId }, _max: { score: true } });
    return { score: saved.score, accuracy: saved.accuracy, roundsCleared: saved.roundsCleared, best: best._max.score ?? saved.score };
  }

  /** Everyone vs everyone: best score per active player, top 50 — this week or all time. */
  async leaderboard(period: 'week' | 'all' = 'all') {
    const rows = await this.prisma.patternMapScore.groupBy({
      by: ['userId'],
      where: { user: { isActive: true }, ...(period === 'week' ? { createdAt: { gte: startOfWeek() } } : {}) },
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
