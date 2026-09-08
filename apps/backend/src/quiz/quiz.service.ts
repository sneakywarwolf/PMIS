import { Injectable, ConflictException, BadRequestException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const BASE_POINTS = 10;
const MAX_STREAK_BONUS = 10;

@Injectable()
export class QuizService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sweepQuizStatuses(): Promise<void> {
    const now = new Date();

    await this.prisma.quizQuestion.updateMany({
      where: { status: 'SCHEDULED', scheduledFor: { lte: now } },
      data: { status: 'ACTIVE' },
    });

    await this.prisma.quizQuestion.updateMany({
      where: { status: 'ACTIVE', scheduledFor: { lte: new Date(now.getTime() - TWENTY_FOUR_HOURS_MS) } },
      data: { status: 'REVEALED', revealedAt: now },
    });
  }

  async submitAnswer(userId: string, questionId: string, selectedOption: number) {
    const question = await this.prisma.quizQuestion.findUnique({ where: { id: questionId } });
    if (!question || question.status !== 'ACTIVE') {
      throw new BadRequestException('This question is not currently active.');
    }

    const existing = await this.prisma.quizAttempt.findUnique({
      where: { questionId_userId: { questionId, userId } },
    });
    if (existing) {
      throw new ConflictException('You have already answered this question.');
    }

    const isCorrect = selectedOption === question.correctIndex;

    return this.prisma.$transaction(async (tx) => {
      const stats = (await tx.quizUserStats.findUnique({ where: { userId } })) ?? {
        userId,
        totalPoints: 0,
        currentStreak: 0,
        bestStreak: 0,
        lastAnsweredOn: null as Date | null,
        badges: [] as string[],
      };

      const nextStreak = isCorrect ? stats.currentStreak + 1 : 0;
      const streakBonus = isCorrect ? Math.min(nextStreak - 1, MAX_STREAK_BONUS) : 0;
      const pointsAwarded = isCorrect ? BASE_POINTS + streakBonus : 0;
      const nextBestStreak = Math.max(stats.bestStreak, nextStreak);

      const attempt = await tx.quizAttempt.create({
        data: { questionId, userId, selectedOption, isCorrect, pointsAwarded },
      });

      const totalAnswered = await tx.quizAttempt.count({ where: { userId } });
      const badges = new Set(stats.badges);
      if (isCorrect && totalAnswered === 1) badges.add('FIRST_CORRECT');
      if (nextStreak === 5) badges.add('STREAK_5');
      if (nextStreak === 10) badges.add('STREAK_10');
      if (nextStreak === 30) badges.add('STREAK_30');
      if (totalAnswered === 50) badges.add('ANSWERED_50');
      if (totalAnswered === 100) badges.add('ANSWERED_100');

      const recentAttempts = await tx.quizAttempt.findMany({
        where: { userId },
        orderBy: { answeredAt: 'desc' },
        take: 7,
      });
      if (recentAttempts.length === 7 && recentAttempts.every((a) => a.isCorrect)) {
        badges.add('PERFECT_WEEK');
      }

      await tx.quizUserStats.upsert({
        where: { userId },
        create: {
          userId,
          totalPoints: pointsAwarded,
          currentStreak: nextStreak,
          bestStreak: nextBestStreak,
          lastAnsweredOn: new Date(),
          badges: Array.from(badges) as any,
        },
        update: {
          totalPoints: stats.totalPoints + pointsAwarded,
          currentStreak: nextStreak,
          bestStreak: nextBestStreak,
          lastAnsweredOn: new Date(),
          badges: Array.from(badges) as any,
        },
      });

      return attempt;
    });
  }
}
