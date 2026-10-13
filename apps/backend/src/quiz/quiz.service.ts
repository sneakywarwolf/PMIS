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
      orderBy: { scheduledFor: 'asc' },
    });
    if (revealing.length > 0) {
      for (const question of revealing) {
        await this.revealQuestion(question, now);
      }
      await this.notifications.notifyAllActiveUsers({
        type: 'QUIZ_ANSWER_REVEALED',
        title: 'Quiz answer revealed',
        message: "The Question of the Day's answer and explanation are now available.",
        linkUrl: '/dashboard/quiz',
      });
    }
  }

  /**
   * Scores every attempt on a question and updates each answerer's stats.
   * Points/streaks/badges are computed here — at reveal time — rather than
   * the instant someone answers, so a user's own scorecard and the
   * leaderboard can't leak whether an unrevealed answer was correct.
   */
  private async revealQuestion(question: { id: string; scheduledFor: Date }, revealedAt: Date) {
    await this.prisma.$transaction(async (tx) => {
      await tx.quizQuestion.update({ where: { id: question.id }, data: { status: 'REVEALED', revealedAt } });

      const attempts = await tx.quizAttempt.findMany({ where: { questionId: question.id, isLate: false } });
      for (const attempt of attempts) {
        const stats = (await tx.quizUserStats.findUnique({ where: { userId: attempt.userId } })) ?? {
          userId: attempt.userId,
          totalPoints: 0,
          currentStreak: 0,
          bestStreak: 0,
          lastAnsweredOn: null as Date | null,
          badges: [] as string[],
        };

        const previousDay = new Date(question.scheduledFor.getTime() - TWENTY_FOUR_HOURS_MS).toDateString();
        const noGap = stats.lastAnsweredOn !== null && stats.lastAnsweredOn.toDateString() === previousDay;
        const nextStreak = attempt.isCorrect ? (noGap ? stats.currentStreak + 1 : 1) : 0;
        const streakBonus = attempt.isCorrect ? Math.min(nextStreak - 1, MAX_STREAK_BONUS) : 0;
        const pointsAwarded = attempt.isCorrect ? BASE_POINTS + streakBonus : 0;
        const nextBestStreak = Math.max(stats.bestStreak, nextStreak);

        await tx.quizAttempt.update({ where: { id: attempt.id }, data: { pointsAwarded } });

        const totalAnswered = await tx.quizAttempt.count({
          where: { userId: attempt.userId, isLate: false, question: { status: 'REVEALED' } },
        });
        const badges = new Set(stats.badges);
        if (attempt.isCorrect && totalAnswered === 1) badges.add('FIRST_CORRECT');
        if (nextStreak === 5) badges.add('STREAK_5');
        if (nextStreak === 10) badges.add('STREAK_10');
        if (nextStreak === 30) badges.add('STREAK_30');
        if (totalAnswered === 50) badges.add('ANSWERED_50');
        if (totalAnswered === 100) badges.add('ANSWERED_100');

        const recentAttempts = await tx.quizAttempt.findMany({
          where: { userId: attempt.userId, isLate: false, question: { status: 'REVEALED' } },
          orderBy: { answeredAt: 'desc' },
          take: 7,
        });
        if (recentAttempts.length === 7 && recentAttempts.every((a) => a.isCorrect)) {
          badges.add('PERFECT_WEEK');
        }

        await tx.quizUserStats.upsert({
          where: { userId: attempt.userId },
          create: {
            userId: attempt.userId,
            totalPoints: pointsAwarded,
            currentStreak: nextStreak,
            bestStreak: nextBestStreak,
            lastAnsweredOn: attempt.answeredAt,
            badges: Array.from(badges) as any,
          },
          update: {
            totalPoints: stats.totalPoints + pointsAwarded,
            currentStreak: nextStreak,
            bestStreak: nextBestStreak,
            lastAnsweredOn: attempt.answeredAt,
            badges: Array.from(badges) as any,
          },
        });
      }
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

    try {
      // pointsAwarded stays 0 until revealQuestion scores it at the 24-hour reveal.
      return await this.prisma.quizAttempt.create({
        data: { questionId, userId, selectedOption, isCorrect, pointsAwarded: 0 },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('You have already answered this question.');
      }
      throw error;
    }
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
    const attempts = await this.prisma.quizAttempt.findMany({ where: { questionId: question.id, isLate: false } });
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

  /** The caller's own attempt on a question, for the log: what they picked and whether it was late. */
  private myAttempt(a?: { selectedOption: number; isCorrect: boolean; isLate: boolean } | null) {
    return a ? { selectedOption: a.selectedOption, isCorrect: a.isCorrect, isLate: a.isLate } : null;
  }

  async getLog(page: number, pageSize: number, userId?: string) {
    const [items, total] = await Promise.all([
      this.prisma.quizQuestion.findMany({
        where: { status: 'REVEALED' },
        orderBy: { revealedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        ...(userId ? { include: { attempts: { where: { userId } } } } : {}),
      }),
      this.prisma.quizQuestion.count({ where: { status: 'REVEALED' } }),
    ]);
    if (!userId) return { items, total };
    return { items: items.map(({ attempts, ...q }: any) => ({ ...q, myAttempt: this.myAttempt(attempts[0]) })), total };
  }

  async getLogEntry(id: string, userId?: string) {
    const question = await this.prisma.quizQuestion.findUnique({ where: { id } });
    if (!question || question.status !== 'REVEALED') {
      throw new BadRequestException('This question is not in the log.');
    }
    const summary = await this.buildRevealedSummary(question);
    if (!userId) return summary;
    const mine = await this.prisma.quizAttempt.findUnique({ where: { questionId_userId: { questionId: id, userId } } });
    return { ...summary, myAttempt: this.myAttempt(mine) };
  }

  /**
   * Answer a question after its reveal. Stored as a late attempt: it is shown to
   * the user but never scored (pointsAwarded 0, isLate excluded from every stat),
   * and the question's status/schedule are untouched. One attempt per user.
   */
  async submitLateAnswer(userId: string, questionId: string, selectedOption: number) {
    const question = await this.prisma.quizQuestion.findUnique({ where: { id: questionId } });
    if (!question || question.status !== 'REVEALED') {
      throw new BadRequestException('This question is not available for late answers.');
    }
    if (selectedOption >= question.options.length) {
      throw new BadRequestException('Invalid option.');
    }
    try {
      const a = await this.prisma.quizAttempt.create({
        data: { questionId, userId, selectedOption, isCorrect: selectedOption === question.correctIndex, pointsAwarded: 0, isLate: true },
      });
      return this.myAttempt(a);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('You have already answered this question.');
      }
      throw error;
    }
  }

  /**
   * Attempts are scored the instant a user answers, but the question's
   * correct option isn't revealed to anyone (including that user) for 24
   * hours. Scorecards/leaderboard must only reflect revealed questions, or
   * a user's own correctness — and others' point/streak movement — leaks
   * the answer early.
   */
  private revealedAttemptsWhere(userId?: string): Prisma.QuizAttemptWhereInput {
    return { ...(userId ? { userId } : {}), isLate: false, question: { status: 'REVEALED' } };
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
    // Aggregated in the database, not by loading every attempt into memory.
    const where = this.revealedAttemptsWhere();
    const [totals, corrects, stats] = await Promise.all([
      this.prisma.quizAttempt.groupBy({ by: ['userId'], where, _sum: { pointsAwarded: true }, _count: { _all: true } }),
      this.prisma.quizAttempt.groupBy({ by: ['userId'], where: { ...where, isCorrect: true }, _count: { _all: true } }),
      this.prisma.quizUserStats.findMany(),
    ]);
    const users = await this.prisma.user.findMany({
      where: { id: { in: totals.map((t) => t.userId) } },
      select: { id: true, fullName: true },
    });
    const nameById = new Map(users.map((u) => [u.id, u.fullName ?? '']));
    const correctById = new Map(corrects.map((c) => [c.userId, c._count._all]));
    const statsById = new Map(stats.map((st) => [st.userId, st]));

    return totals
      .map((t) => {
        const st = statsById.get(t.userId);
        return {
          userId: t.userId,
          fullName: nameById.get(t.userId) ?? '',
          totalPoints: t._sum.pointsAwarded ?? 0,
          currentStreak: st?.currentStreak ?? 0,
          bestStreak: st?.bestStreak ?? 0,
          badges: st?.badges ?? [],
          accuracy: t._count._all ? (correctById.get(t.userId) ?? 0) / t._count._all : 0,
        };
      })
      .sort((x, y) => y.totalPoints - x.totalPoints || y.accuracy - x.accuracy);
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
