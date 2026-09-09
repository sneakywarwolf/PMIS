import { Injectable, ConflictException, BadRequestException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateQuizQuestionDto } from './dto/create-quiz-question.dto';
import { UpdateQuizQuestionDto } from './dto/update-quiz-question.dto';

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

      const previousDay = new Date(question.scheduledFor.getTime() - TWENTY_FOUR_HOURS_MS).toDateString();
      const noGap = stats.lastAnsweredOn !== null && stats.lastAnsweredOn.toDateString() === previousDay;
      const nextStreak = isCorrect ? (noGap ? stats.currentStreak + 1 : 1) : 0;
      const streakBonus = isCorrect ? Math.min(nextStreak - 1, MAX_STREAK_BONUS) : 0;
      const pointsAwarded = isCorrect ? BASE_POINTS + streakBonus : 0;
      const nextBestStreak = Math.max(stats.bestStreak, nextStreak);

      let attempt;
      try {
        attempt = await tx.quizAttempt.create({
          data: { questionId, userId, selectedOption, isCorrect, pointsAwarded },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('You have already answered this question.');
        }
        throw error;
      }

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

  async getTodayQuestion(userId: string) {
    const active = await this.prisma.quizQuestion.findFirst({ where: { status: 'ACTIVE' }, orderBy: { scheduledFor: 'desc' } });
    if (active) {
      const alreadyAnswered = await this.prisma.quizAttempt.findUnique({
        where: { questionId_userId: { questionId: active.id, userId } },
      });
      return {
        id: active.id,
        question: active.question,
        options: active.options,
        scheduledFor: active.scheduledFor,
        status: active.status,
        alreadyAnswered: Boolean(alreadyAnswered),
      };
    }

    const recentlyRevealed = await this.prisma.quizQuestion.findFirst({
      where: { status: 'REVEALED', revealedAt: { gte: new Date(Date.now() - TWENTY_FOUR_HOURS_MS) } },
      orderBy: { revealedAt: 'desc' },
    });
    if (!recentlyRevealed) return null;

    return this.buildRevealedSummary(recentlyRevealed);
  }

  private async buildRevealedSummary(question: { id: string; question: string; options: string[]; correctIndex: number; explanation: string; revealedAt: Date | null }) {
    const attempts = await this.prisma.quizAttempt.findMany({ where: { questionId: question.id } });
    const correctCount = attempts.filter((a) => a.isCorrect).length;
    return {
      id: question.id,
      question: question.question,
      options: question.options,
      correctIndex: question.correctIndex,
      explanation: question.explanation,
      revealedAt: question.revealedAt,
      participants: attempts.length,
      correctCount,
      incorrectCount: attempts.length - correctCount,
    };
  }

  async getLog(page: number, pageSize: number) {
    const [items, total] = await Promise.all([
      this.prisma.quizQuestion.findMany({
        where: { status: 'REVEALED' },
        orderBy: { revealedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.quizQuestion.count({ where: { status: 'REVEALED' } }),
    ]);
    return { items, total };
  }

  async getLogEntry(id: string) {
    const question = await this.prisma.quizQuestion.findUnique({ where: { id } });
    if (!question || question.status !== 'REVEALED') {
      throw new BadRequestException('This question is not in the log.');
    }
    return this.buildRevealedSummary(question);
  }

  async getScorecard(userId: string) {
    const stats = await this.prisma.quizUserStats.findUnique({ where: { userId } });
    const attempts = await this.prisma.quizAttempt.findMany({ where: { userId } });
    const correct = attempts.filter((a) => a.isCorrect).length;
    return {
      totalAnswered: attempts.length,
      correct,
      incorrect: attempts.length - correct,
      accuracy: attempts.length ? Math.round((correct / attempts.length) * 100) : 0,
      totalPoints: stats?.totalPoints ?? 0,
      currentStreak: stats?.currentStreak ?? 0,
      bestStreak: stats?.bestStreak ?? 0,
      badges: stats?.badges ?? [],
    };
  }

  async getLeaderboard() {
    const allStats = await this.prisma.quizUserStats.findMany({
      include: { user: { select: { id: true, fullName: true } } },
      orderBy: { totalPoints: 'desc' },
    });

    const withAccuracy = await Promise.all(
      allStats.map(async (s: any) => {
        const attempts = await this.prisma.quizAttempt.findMany({ where: { userId: s.userId } });
        const correct = attempts.filter((a) => a.isCorrect).length;
        const accuracy = attempts.length ? correct / attempts.length : 0;
        return {
          userId: s.userId,
          fullName: s.user.fullName,
          totalPoints: s.totalPoints,
          currentStreak: s.currentStreak,
          bestStreak: s.bestStreak,
          badges: s.badges,
          accuracy,
        };
      }),
    );

    return withAccuracy.sort((a, b) => b.totalPoints - a.totalPoints || b.accuracy - a.accuracy);
  }

  async createQuestion(createdById: string, dto: CreateQuizQuestionDto, ipAddress: string, userAgent: string) {
    const created = await this.prisma.quizQuestion.create({
      data: { ...dto, scheduledFor: new Date(dto.scheduledFor), createdById },
    });
    await this.audit.log({
      action: 'QUIZ_QUESTION_CREATED',
      actorId: createdById,
      targetType: 'QUIZ_QUESTION',
      targetId: created.id,
      ipAddress,
      userAgent,
    });
    return created;
  }

  async updateQuestion(id: string, dto: UpdateQuizQuestionDto, actorId: string, ipAddress: string, userAgent: string) {
    const question = await this.prisma.quizQuestion.findUnique({ where: { id } });
    if (!question || question.status !== 'SCHEDULED') {
      throw new BadRequestException('Only a scheduled question can be edited.');
    }
    const data: any = { ...dto };
    if (dto.scheduledFor) data.scheduledFor = new Date(dto.scheduledFor);
    const updated = await this.prisma.quizQuestion.update({ where: { id }, data });
    await this.audit.log({
      action: 'QUIZ_QUESTION_UPDATED',
      actorId,
      targetType: 'QUIZ_QUESTION',
      targetId: id,
      ipAddress,
      userAgent,
    });
    return updated;
  }

  async listQuestions() {
    return this.prisma.quizQuestion.findMany({ orderBy: { scheduledFor: 'desc' } });
  }

  async getQuestionResponses(id: string) {
    const question = await this.prisma.quizQuestion.findUnique({ where: { id } });
    if (!question) throw new BadRequestException('Question not found.');
    const attempts = await this.prisma.quizAttempt.findMany({
      where: { questionId: id },
      include: { user: { select: { id: true, fullName: true } } },
    });
    return { question, attempts };
  }
}
