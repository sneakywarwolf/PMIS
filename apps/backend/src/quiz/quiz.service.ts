import { Injectable, ConflictException, BadRequestException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
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
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sweepQuizStatuses(): Promise<void> {
    const now = new Date();

    const activating = await this.prisma.quizQuestion.findMany({
      where: { status: 'SCHEDULED', scheduledFor: { lte: now } },
      select: { id: true },
    });
    if (activating.length > 0) {
      await this.prisma.quizQuestion.updateMany({
        where: { id: { in: activating.map((q) => q.id) } },
        data: { status: 'ACTIVE' },
      });
      await this.notifications.notifyAllActiveUsers({
        type: 'QUIZ_QUESTION_LIVE',
        title: 'New Question of the Day',
        message: "Today's quiz question is live — answer it within 24 hours.",
        linkUrl: '/dashboard/quiz',
      });
    }

    const revealing = await this.prisma.quizQuestion.findMany({
      where: { status: 'ACTIVE', scheduledFor: { lte: new Date(now.getTime() - TWENTY_FOUR_HOURS_MS) } },
      select: { id: true },
    });
    if (revealing.length > 0) {
      await this.prisma.quizQuestion.updateMany({
        where: { id: { in: revealing.map((q) => q.id) } },
        data: { status: 'REVEALED', revealedAt: now },
      });
      await this.notifications.notifyAllActiveUsers({
        type: 'QUIZ_ANSWER_REVEALED',
        title: 'Quiz answer revealed',
        message: "The Question of the Day's answer and explanation are now available.",
        linkUrl: '/dashboard/quiz',
      });
    }
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

    return this.buildRevealedSummary(recentlyRevealed, userId);
  }

  private async buildRevealedSummary(
    question: { id: string; question: string; options: string[]; correctIndex: number; explanation: string; revealedAt: Date | null },
    userId?: string,
  ) {
    const attempts = await this.prisma.quizAttempt.findMany({ where: { questionId: question.id } });
    const correctCount = attempts.filter((a) => a.isCorrect).length;
    const userIsCorrect = userId ? attempts.find((a) => a.userId === userId)?.isCorrect ?? null : null;
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
      userIsCorrect,
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

  /**
   * Attempts are scored the instant a user answers, but the question's
   * correct option isn't revealed to anyone (including that user) for 24
   * hours. Scorecards/leaderboard must only reflect revealed questions, or
   * a user's own correctness — and others' point/streak movement — leaks
   * the answer early.
   */
  private revealedAttemptsWhere(userId?: string): Prisma.QuizAttemptWhereInput {
    return { ...(userId ? { userId } : {}), question: { status: 'REVEALED' } };
  }

  async getScorecard(userId: string) {
    const attempts = await this.prisma.quizAttempt.findMany({ where: this.revealedAttemptsWhere(userId) });
    const correct = attempts.filter((a) => a.isCorrect).length;
    const stats = await this.prisma.quizUserStats.findUnique({ where: { userId } });
    return {
      totalAnswered: attempts.length,
      correct,
      incorrect: attempts.length - correct,
      accuracy: attempts.length ? Math.round((correct / attempts.length) * 100) : 0,
      totalPoints: attempts.reduce((sum, a) => sum + a.pointsAwarded, 0),
      currentStreak: stats?.currentStreak ?? 0,
      bestStreak: stats?.bestStreak ?? 0,
      badges: stats?.badges ?? [],
    };
  }

  async getLeaderboard() {
    const attempts = await this.prisma.quizAttempt.findMany({
      where: this.revealedAttemptsWhere(),
      include: { user: { select: { id: true, fullName: true } } },
    });
    const stats = await this.prisma.quizUserStats.findMany();
    const statsByUserId = new Map(stats.map((s) => [s.userId, s]));

    const byUser = new Map<string, { userId: string; fullName: string; totalPoints: number; correct: number; total: number }>();
    for (const a of attempts) {
      const entry = byUser.get(a.userId) ?? { userId: a.userId, fullName: a.user.fullName ?? '', totalPoints: 0, correct: 0, total: 0 };
      entry.totalPoints += a.pointsAwarded;
      entry.total += 1;
      if (a.isCorrect) entry.correct += 1;
      byUser.set(a.userId, entry);
    }

    const result = Array.from(byUser.values()).map((entry) => {
      const s = statsByUserId.get(entry.userId);
      return {
        userId: entry.userId,
        fullName: entry.fullName,
        totalPoints: entry.totalPoints,
        currentStreak: s?.currentStreak ?? 0,
        bestStreak: s?.bestStreak ?? 0,
        badges: s?.badges ?? [],
        accuracy: entry.total ? entry.correct / entry.total : 0,
      };
    });

    return result.sort((a, b) => b.totalPoints - a.totalPoints || b.accuracy - a.accuracy);
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

  async deleteQuestion(id: string, actorId: string, ipAddress: string, userAgent: string) {
    const question = await this.prisma.quizQuestion.findUnique({ where: { id } });
    if (!question) {
      throw new BadRequestException('Question not found.');
    }
    await this.prisma.quizQuestion.delete({ where: { id } });
    await this.audit.log({
      action: 'QUIZ_QUESTION_DELETED',
      actorId,
      targetType: 'QUIZ_QUESTION',
      targetId: id,
      ipAddress,
      userAgent,
    });
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
