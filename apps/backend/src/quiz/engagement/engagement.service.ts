import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { startOfWeek } from '../arcade/arcade.service';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Admin-only health check on whether the Quiz / Arcade features are actually being used. */
@Injectable()
export class EngagementService {
  constructor(private readonly prisma: PrismaService) {}

  async summary() {
    const since = new Date(Date.now() - WEEK_MS);
    const thisWeek = startOfWeek();
    const [activeUsers, revealedQuestions, attempts, quizParticipants] = await Promise.all([
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.quizQuestion.count({ where: { status: 'REVEALED', scheduledFor: { gte: since } } }),
      this.prisma.quizAttempt.count({ where: { question: { status: 'REVEALED', scheduledFor: { gte: since } } } }),
      this.prisma.quizAttempt.groupBy({ by: ['userId'], where: { answeredAt: { gte: since } } }),
    ]);

    // Last 4 ISO-style weeks (oldest first) of arcade activity.
    const weeks = await Promise.all(
      [3, 2, 1, 0].map(async (back) => {
        const from = new Date(thisWeek.getTime() - back * WEEK_MS);
        const to = new Date(from.getTime() + WEEK_MS);
        const where = { createdAt: { gte: from, lt: to } };
        const [plays, players] = await Promise.all([
          this.prisma.patternMapScore.count({ where }),
          this.prisma.patternMapScore.groupBy({ by: ['userId'], where }),
        ]);
        return { weekStart: from.toISOString().slice(0, 10), plays, players: players.length };
      }),
    );

    return {
      activeUsers,
      quiz: {
        participantsLast7Days: quizParticipants.length,
        // answers received vs. answers possible if every active user answered every revealed question
        participationRate: activeUsers && revealedQuestions ? Math.round((attempts / (activeUsers * revealedQuestions)) * 100) : 0,
        revealedQuestionsLast7Days: revealedQuestions,
      },
      arcade: { weeks },
    };
  }
}
