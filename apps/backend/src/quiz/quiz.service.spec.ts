import { Test } from '@nestjs/testing';
import { QuizService } from './quiz.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

function makePrismaMock(): any {
  return {
    quizQuestion: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    quizAttempt: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      groupBy: jest.fn(),
      count: jest.fn(),
    },
    quizUserStats: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn((cb: any) => cb(prisma)),
  } as any;
}

let prisma: ReturnType<typeof makePrismaMock>;

describe('QuizService.sweepQuizStatuses', () => {
  let service: QuizService;
  let audit: { log: jest.Mock };
  let notifications: { notifyAllActiveUsers: jest.Mock };

  beforeEach(async () => {
    prisma = makePrismaMock();
    audit = { log: jest.fn() };
    notifications = { notifyAllActiveUsers: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        QuizService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = moduleRef.get(QuizService);
  });

  it('activates SCHEDULED questions whose scheduledFor has arrived, and notifies all active users', async () => {
    prisma.quizQuestion.findMany.mockResolvedValueOnce([{ id: 'q1' }]).mockResolvedValueOnce([]);

    await service.sweepQuizStatuses();

    expect(prisma.quizQuestion.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['q1'] } },
      data: { status: 'ACTIVE' },
    });
    expect(notifications.notifyAllActiveUsers).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'QUIZ_QUESTION_LIVE' }),
    );
  });

  it('reveals ACTIVE questions older than 24 hours, scores attempts, and notifies all active users', async () => {
    const scheduledFor = new Date('2026-09-08T00:00:00.000Z');
    prisma.quizQuestion.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'q2', scheduledFor }]);
    prisma.quizAttempt.findMany.mockResolvedValue([
      { id: 'a1', userId: 'u1', isCorrect: true, answeredAt: new Date('2026-09-08T01:00:00.000Z') },
    ]);
    prisma.quizUserStats.findUnique.mockResolvedValue(null);
    prisma.quizAttempt.count.mockResolvedValue(1);

    await service.sweepQuizStatuses();

    expect(prisma.quizQuestion.update).toHaveBeenCalledWith({
      where: { id: 'q2' },
      data: { status: 'REVEALED', revealedAt: expect.any(Date) },
    });
    expect(prisma.quizAttempt.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { pointsAwarded: 10 },
    });
    expect(prisma.quizUserStats.upsert).toHaveBeenCalled();
    expect(notifications.notifyAllActiveUsers).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'QUIZ_ANSWER_REVEALED' }),
    );
  });

  it('does not update or notify when nothing needs to transition', async () => {
    await service.sweepQuizStatuses();

    expect(prisma.quizQuestion.updateMany).not.toHaveBeenCalled();
    expect(notifications.notifyAllActiveUsers).not.toHaveBeenCalled();
  });
});

describe('QuizService.submitAnswer', () => {
  let service: QuizService;
  let audit: { log: jest.Mock };

  beforeEach(async () => {
    prisma = makePrismaMock();
    audit = { log: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        QuizService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: NotificationsService, useValue: { notifyAllActiveUsers: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(QuizService);
  });

  it('rejects an answer if the question is not ACTIVE', async () => {
    prisma.quizQuestion.findUnique.mockResolvedValue({ id: 'q1', status: 'REVEALED', correctIndex: 0 });

    await expect(service.submitAnswer('u1', 'q1', 0)).rejects.toThrow(BadRequestException);
  });

  it('rejects a second submission for the same question by the same user', async () => {
    prisma.quizQuestion.findUnique.mockResolvedValue({ id: 'q1', status: 'ACTIVE', correctIndex: 0, scheduledFor: new Date('2026-09-09T00:00:00.000Z') });
    prisma.quizAttempt.findUnique.mockResolvedValue({ id: 'existing-attempt' });

    await expect(service.submitAnswer('u1', 'q1', 0)).rejects.toThrow(ConflictException);
  });

  it('records isCorrect but leaves pointsAwarded at 0 — scoring happens later at reveal', async () => {
    const scheduledFor = new Date('2026-09-09T00:00:00.000Z');
    prisma.quizQuestion.findUnique.mockResolvedValue({ id: 'q1', status: 'ACTIVE', correctIndex: 2, scheduledFor });
    prisma.quizAttempt.findUnique.mockResolvedValue(null);
    prisma.quizAttempt.create.mockResolvedValue({ id: 'a1', isCorrect: true, pointsAwarded: 0 });

    const result = await service.submitAnswer('u1', 'q1', 2);

    expect(result.isCorrect).toBe(true);
    expect(prisma.quizAttempt.create).toHaveBeenCalledWith({
      data: { questionId: 'q1', userId: 'u1', selectedOption: 2, isCorrect: true, pointsAwarded: 0 },
    });
    expect(prisma.quizUserStats.upsert).not.toHaveBeenCalled();
  });

  it('maps a unique-constraint violation on create to a 409 Conflict', async () => {
    const scheduledFor = new Date('2026-09-09T00:00:00.000Z');
    prisma.quizQuestion.findUnique.mockResolvedValue({ id: 'q1', status: 'ACTIVE', correctIndex: 0, scheduledFor });
    prisma.quizAttempt.findUnique.mockResolvedValue(null);
    const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    Object.setPrototypeOf(p2002, Prisma.PrismaClientKnownRequestError.prototype);
    prisma.quizAttempt.create.mockRejectedValue(p2002);

    await expect(service.submitAnswer('u1', 'q1', 0)).rejects.toThrow(ConflictException);
  });
});

describe('QuizService.revealQuestion (via sweepQuizStatuses)', () => {
  let service: QuizService;

  beforeEach(async () => {
    prisma = makePrismaMock();
    const moduleRef = await Test.createTestingModule({
      providers: [
        QuizService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: NotificationsService, useValue: { notifyAllActiveUsers: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(QuizService);
  });

  it('awards base points and increments streak on a correct answer with no gap since last answer', async () => {
    const scheduledFor = new Date('2026-09-09T00:00:00.000Z');
    const previousDay = new Date('2026-09-08T12:00:00.000Z'); // same calendar day as scheduledFor - 24h
    prisma.quizQuestion.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'q1', scheduledFor }]);
    prisma.quizAttempt.findMany.mockResolvedValue([{ id: 'a1', userId: 'u1', isCorrect: true, answeredAt: new Date() }]);
    prisma.quizUserStats.findUnique.mockResolvedValue({
      userId: 'u1',
      totalPoints: 0,
      currentStreak: 0,
      bestStreak: 0,
      lastAnsweredOn: previousDay,
      badges: [],
    });
    prisma.quizAttempt.count.mockResolvedValue(1);

    await service.sweepQuizStatuses();

    const upsertArg = prisma.quizUserStats.upsert.mock.calls[0][0];
    expect(upsertArg.create.totalPoints).toBe(10);
    expect(upsertArg.create.currentStreak).toBe(1);
    expect(upsertArg.create.badges).toContain('FIRST_CORRECT');
  });

  it('awards zero points on an incorrect answer and resets streak', async () => {
    const scheduledFor = new Date('2026-09-09T00:00:00.000Z');
    const previousDay = new Date('2026-09-08T12:00:00.000Z');
    prisma.quizQuestion.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'q1', scheduledFor }]);
    prisma.quizAttempt.findMany.mockResolvedValue([{ id: 'a1', userId: 'u1', isCorrect: false, answeredAt: new Date() }]);
    prisma.quizUserStats.findUnique.mockResolvedValue({
      userId: 'u1',
      totalPoints: 20,
      currentStreak: 3,
      bestStreak: 3,
      lastAnsweredOn: previousDay,
      badges: [],
    });
    prisma.quizAttempt.count.mockResolvedValue(4);

    await service.sweepQuizStatuses();

    const upsertArg = prisma.quizUserStats.upsert.mock.calls[0][0];
    expect(upsertArg.update.currentStreak).toBe(0);
    expect(upsertArg.update.totalPoints).toBe(20);
  });

  it('restarts the streak at 1 when a question was skipped since the last answer', async () => {
    const scheduledFor = new Date('2026-09-09T00:00:00.000Z');
    const lastAnsweredOn = new Date('2026-09-07T12:00:00.000Z'); // one question skipped in between
    prisma.quizQuestion.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'q1', scheduledFor }]);
    prisma.quizAttempt.findMany.mockResolvedValue([{ id: 'a1', userId: 'u1', isCorrect: true, answeredAt: new Date() }]);
    prisma.quizUserStats.findUnique.mockResolvedValue({
      userId: 'u1',
      totalPoints: 50,
      currentStreak: 5,
      bestStreak: 5,
      lastAnsweredOn,
      badges: [],
    });
    prisma.quizAttempt.count.mockResolvedValue(10);

    await service.sweepQuizStatuses();

    const upsertArg = prisma.quizUserStats.upsert.mock.calls[0][0];
    expect(upsertArg.update.currentStreak).toBe(1);
  });
});

describe('QuizService admin/read methods', () => {
  let service: QuizService;
  let audit: { log: jest.Mock };

  beforeEach(async () => {
    prisma = makePrismaMock();
    audit = { log: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        QuizService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: NotificationsService, useValue: { notifyAllActiveUsers: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(QuizService);
  });

  it('getTodayQuestion includes userIsCorrect for the viewing user on a revealed question', async () => {
    prisma.quizQuestion.findFirst
      .mockResolvedValueOnce(null) // no ACTIVE question
      .mockResolvedValueOnce({
        id: 'q1',
        question: 'Q?',
        options: ['a', 'b', 'c', 'd'],
        correctIndex: 1,
        explanation: 'because',
        revealedAt: new Date(),
      });
    prisma.quizAttempt.findMany.mockResolvedValue([
      { userId: 'u1', isCorrect: false },
      { userId: 'u2', isCorrect: true },
    ]);

    const result: any = await service.getTodayQuestion('u1');

    expect(result.userIsCorrect).toBe(false);
  });

  it('getTodayQuestion returns userIsCorrect null when the viewing user never answered', async () => {
    prisma.quizQuestion.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'q1',
        question: 'Q?',
        options: ['a', 'b', 'c', 'd'],
        correctIndex: 1,
        explanation: 'because',
        revealedAt: new Date(),
      });
    prisma.quizAttempt.findMany.mockResolvedValue([{ userId: 'u2', isCorrect: true }]);

    const result: any = await service.getTodayQuestion('u1');

    expect(result.userIsCorrect).toBeNull();
  });

  it('createQuestion creates the question and logs an audit entry with ipAddress/userAgent', async () => {
    const dto = {
      question: 'Q?',
      options: ['a', 'b', 'c', 'd'],
      correctIndex: 1,
      explanation: 'because',
      scheduledFor: '2026-09-10T00:00:00.000Z',
    } as any;
    prisma.quizQuestion.create.mockResolvedValue({ id: 'q1', ...dto });

    const result = await service.createQuestion('admin1', dto, '1.2.3.4', 'jest-agent');

    expect(result.id).toBe('q1');
    expect(audit.log).toHaveBeenCalledWith({
      action: 'QUIZ_QUESTION_CREATED',
      actorId: 'admin1',
      targetType: 'QUIZ_QUESTION',
      targetId: 'q1',
      ipAddress: '1.2.3.4',
      userAgent: 'jest-agent',
    });
  });

  it('updateQuestion updates a SCHEDULED question and logs an audit entry with ipAddress/userAgent', async () => {
    prisma.quizQuestion.findUnique.mockResolvedValue({ id: 'q1', status: 'SCHEDULED' });
    prisma.quizQuestion.update.mockResolvedValue({ id: 'q1', question: 'Updated?' });

    const result = await service.updateQuestion('q1', { question: 'Updated?' } as any, 'admin1', '1.2.3.4', 'jest-agent');

    expect(result.question).toBe('Updated?');
    expect(audit.log).toHaveBeenCalledWith({
      action: 'QUIZ_QUESTION_UPDATED',
      actorId: 'admin1',
      targetType: 'QUIZ_QUESTION',
      targetId: 'q1',
      ipAddress: '1.2.3.4',
      userAgent: 'jest-agent',
    });
  });

  it('updateQuestion rejects editing a non-SCHEDULED question', async () => {
    prisma.quizQuestion.findUnique.mockResolvedValue({ id: 'q1', status: 'ACTIVE' });

    await expect(
      service.updateQuestion('q1', { question: 'x' } as any, 'admin1', '1.2.3.4', 'jest-agent'),
    ).rejects.toThrow(BadRequestException);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('deleteQuestion deletes the question regardless of status and logs an audit entry', async () => {
    prisma.quizQuestion.findUnique.mockResolvedValue({ id: 'q1', status: 'ACTIVE' });
    prisma.quizQuestion.delete.mockResolvedValue({ id: 'q1' });

    await service.deleteQuestion('q1', 'admin1', '1.2.3.4', 'jest-agent');

    expect(prisma.quizQuestion.delete).toHaveBeenCalledWith({ where: { id: 'q1' } });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'QUIZ_QUESTION_DELETED', targetId: 'q1', actorId: 'admin1' }),
    );
  });

  it('deleteQuestion throws when the question does not exist', async () => {
    prisma.quizQuestion.findUnique.mockResolvedValue(null);

    await expect(service.deleteQuestion('missing', 'admin1', '1.2.3.4', 'jest-agent')).rejects.toThrow(BadRequestException);
    expect(prisma.quizQuestion.delete).not.toHaveBeenCalled();
  });

  it('getScorecard returns computed accuracy and stats defaults', async () => {
    prisma.quizUserStats.findUnique.mockResolvedValue(null);
    prisma.quizAttempt.findMany.mockResolvedValue([
      { isCorrect: true, pointsAwarded: 10 },
      { isCorrect: false, pointsAwarded: 0 },
    ]);

    const result = await service.getScorecard('u1');

    expect(result.totalAnswered).toBe(2);
    expect(result.correct).toBe(1);
    expect(result.accuracy).toBe(50);
    expect(result.totalPoints).toBe(10);
  });

  it('getScorecard only counts attempts on revealed questions', async () => {
    prisma.quizUserStats.findUnique.mockResolvedValue(null);
    prisma.quizAttempt.findMany.mockResolvedValue([]);

    await service.getScorecard('u1');

    expect(prisma.quizAttempt.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', question: { status: 'REVEALED' } },
    });
  });

  it('getLog returns paginated REVEALED questions', async () => {
    prisma.quizQuestion.findMany.mockResolvedValue([{ id: 'q1' }]);
    prisma.quizQuestion.count.mockResolvedValue(1);

    const result = await service.getLog(1, 20);

    expect(result.items).toEqual([{ id: 'q1' }]);
    expect(result.total).toBe(1);
  });

  it('listQuestions returns all questions ordered by scheduledFor desc', async () => {
    prisma.quizQuestion.findMany.mockResolvedValue([{ id: 'q1' }]);

    const result = await service.listQuestions();

    expect(result).toEqual([{ id: 'q1' }]);
    expect(prisma.quizQuestion.findMany).toHaveBeenCalledWith({ orderBy: { scheduledFor: 'desc' } });
  });

  it('getLeaderboard breaks totalPoints ties by accuracy percentage', async () => {
    prisma.quizUserStats.findMany.mockResolvedValue([
      { userId: 'u1', currentStreak: 1, bestStreak: 1, badges: [] },
      { userId: 'u2', currentStreak: 1, bestStreak: 1, badges: [] },
    ]);
    // Both users score 10 total pts; u1 gets it from 1/4 correct (25%),
    // u2 gets it from 1/4 correct too but with 3 extra zero-point correct answers (75% accuracy).
    const attempt = (userId: string, fullName: string, isCorrect: boolean, pointsAwarded: number) => ({
      userId,
      isCorrect,
      pointsAwarded,
      user: { id: userId, fullName },
    });
    prisma.quizAttempt.findMany.mockResolvedValue([
      attempt('u1', 'Low Accuracy', true, 10),
      attempt('u1', 'Low Accuracy', false, 0),
      attempt('u1', 'Low Accuracy', false, 0),
      attempt('u1', 'Low Accuracy', false, 0),
      attempt('u2', 'High Accuracy', true, 10),
      attempt('u2', 'High Accuracy', true, 0),
      attempt('u2', 'High Accuracy', true, 0),
      attempt('u2', 'High Accuracy', false, 0),
    ]);

    const result = await service.getLeaderboard();

    expect(result[0].userId).toBe('u2');
    expect(result[1].userId).toBe('u1');
    expect(prisma.quizAttempt.findMany).toHaveBeenCalledWith({
      where: { question: { status: 'REVEALED' } },
      include: { user: { select: { id: true, fullName: true } } },
    });
  });

  it('getLeaderboard only counts attempts on revealed questions', async () => {
    prisma.quizUserStats.findMany.mockResolvedValue([]);
    prisma.quizAttempt.findMany.mockResolvedValue([]);

    const result = await service.getLeaderboard();

    expect(result).toEqual([]);
  });
});
