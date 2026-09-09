import { Test } from '@nestjs/testing';
import { QuizService } from './quiz.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

function makePrismaMock(): any {
  return {
    quizQuestion: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    quizAttempt: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
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

  beforeEach(async () => {
    prisma = makePrismaMock();
    audit = { log: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        QuizService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    service = moduleRef.get(QuizService);
  });

  it('activates SCHEDULED questions whose scheduledFor has arrived', async () => {
    await service.sweepQuizStatuses();

    expect(prisma.quizQuestion.updateMany).toHaveBeenCalledWith({
      where: { status: 'SCHEDULED', scheduledFor: { lte: expect.any(Date) } },
      data: { status: 'ACTIVE' },
    });
  });

  it('reveals ACTIVE questions older than 24 hours', async () => {
    await service.sweepQuizStatuses();

    expect(prisma.quizQuestion.updateMany).toHaveBeenCalledWith({
      where: { status: 'ACTIVE', scheduledFor: { lte: expect.any(Date) } },
      data: { status: 'REVEALED', revealedAt: expect.any(Date) },
    });
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

  it('awards base points and increments streak on a correct answer with no gap since last answer', async () => {
    const scheduledFor = new Date('2026-09-09T00:00:00.000Z');
    const previousDay = new Date('2026-09-08T12:00:00.000Z'); // same calendar day as scheduledFor - 24h
    prisma.quizQuestion.findUnique.mockResolvedValue({ id: 'q1', status: 'ACTIVE', correctIndex: 2, scheduledFor });
    prisma.quizAttempt.findUnique.mockResolvedValue(null);
    prisma.quizUserStats.findUnique.mockResolvedValue({
      userId: 'u1',
      totalPoints: 0,
      currentStreak: 0,
      bestStreak: 0,
      lastAnsweredOn: previousDay,
      badges: [],
    });
    prisma.quizAttempt.create.mockResolvedValue({ id: 'a1', isCorrect: true, pointsAwarded: 10 });
    prisma.quizAttempt.count.mockResolvedValue(1);
    prisma.quizAttempt.findMany.mockResolvedValue([{ isCorrect: true }]);

    const result = await service.submitAnswer('u1', 'q1', 2);

    expect(result.isCorrect).toBe(true);
    expect(prisma.quizUserStats.upsert).toHaveBeenCalled();
    const upsertArg = prisma.quizUserStats.upsert.mock.calls[0][0];
    expect(upsertArg.create.totalPoints).toBe(10);
    expect(upsertArg.create.currentStreak).toBe(1);
    expect(upsertArg.create.badges).toContain('FIRST_CORRECT');
  });

  it('awards zero points on an incorrect answer and resets streak', async () => {
    const scheduledFor = new Date('2026-09-09T00:00:00.000Z');
    const previousDay = new Date('2026-09-08T12:00:00.000Z');
    prisma.quizQuestion.findUnique.mockResolvedValue({ id: 'q1', status: 'ACTIVE', correctIndex: 2, scheduledFor });
    prisma.quizAttempt.findUnique.mockResolvedValue(null);
    prisma.quizUserStats.findUnique.mockResolvedValue({
      userId: 'u1',
      totalPoints: 20,
      currentStreak: 3,
      bestStreak: 3,
      lastAnsweredOn: previousDay,
      badges: [],
    });
    prisma.quizAttempt.create.mockResolvedValue({ id: 'a1', isCorrect: false, pointsAwarded: 0 });
    prisma.quizAttempt.count.mockResolvedValue(4);
    prisma.quizAttempt.findMany.mockResolvedValue([]);

    await service.submitAnswer('u1', 'q1', 0);

    const upsertArg = prisma.quizUserStats.upsert.mock.calls[0][0];
    expect(upsertArg.update.currentStreak).toBe(0);
    expect(upsertArg.update.totalPoints).toBe(20);
  });

  it('restarts the streak at 1 when a question was skipped since the last answer', async () => {
    // last answered two days before this question's scheduledFor (one question skipped in between)
    const scheduledFor = new Date('2026-09-09T00:00:00.000Z');
    const lastAnsweredOn = new Date('2026-09-07T12:00:00.000Z');
    prisma.quizQuestion.findUnique.mockResolvedValue({ id: 'q1', status: 'ACTIVE', correctIndex: 2, scheduledFor });
    prisma.quizAttempt.findUnique.mockResolvedValue(null);
    prisma.quizUserStats.findUnique.mockResolvedValue({
      userId: 'u1',
      totalPoints: 50,
      currentStreak: 5,
      bestStreak: 5,
      lastAnsweredOn,
      badges: [],
    });
    prisma.quizAttempt.create.mockResolvedValue({ id: 'a1', isCorrect: true, pointsAwarded: 10 });
    prisma.quizAttempt.count.mockResolvedValue(10);
    prisma.quizAttempt.findMany.mockResolvedValue([]);

    await service.submitAnswer('u1', 'q1', 2);

    const upsertArg = prisma.quizUserStats.upsert.mock.calls[0][0];
    expect(upsertArg.update.currentStreak).toBe(1);
  });

  it('maps a unique-constraint violation on create to a 409 Conflict', async () => {
    const scheduledFor = new Date('2026-09-09T00:00:00.000Z');
    prisma.quizQuestion.findUnique.mockResolvedValue({ id: 'q1', status: 'ACTIVE', correctIndex: 0, scheduledFor });
    prisma.quizAttempt.findUnique.mockResolvedValue(null);
    prisma.quizUserStats.findUnique.mockResolvedValue({
      userId: 'u1',
      totalPoints: 0,
      currentStreak: 0,
      bestStreak: 0,
      lastAnsweredOn: null,
      badges: [],
    });
    const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    Object.setPrototypeOf(p2002, Prisma.PrismaClientKnownRequestError.prototype);
    prisma.quizAttempt.create.mockRejectedValue(p2002);

    await expect(service.submitAnswer('u1', 'q1', 0)).rejects.toThrow(ConflictException);
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

  it('getScorecard returns computed accuracy and stats defaults', async () => {
    prisma.quizUserStats.findUnique.mockResolvedValue(null);
    prisma.quizAttempt.findMany.mockResolvedValue([{ isCorrect: true }, { isCorrect: false }]);

    const result = await service.getScorecard('u1');

    expect(result.totalAnswered).toBe(2);
    expect(result.correct).toBe(1);
    expect(result.accuracy).toBe(50);
    expect(result.totalPoints).toBe(0);
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
      { userId: 'u1', totalPoints: 50, currentStreak: 1, bestStreak: 1, badges: [], user: { id: 'u1', fullName: 'Low Accuracy' } },
      { userId: 'u2', totalPoints: 50, currentStreak: 1, bestStreak: 1, badges: [], user: { id: 'u2', fullName: 'High Accuracy' } },
    ]);
    prisma.quizAttempt.findMany.mockImplementation(({ where }: any) => {
      if (where.userId === 'u1') {
        // 1/4 correct = 25% accuracy
        return Promise.resolve([{ isCorrect: true }, { isCorrect: false }, { isCorrect: false }, { isCorrect: false }]);
      }
      // 3/4 correct = 75% accuracy
      return Promise.resolve([{ isCorrect: true }, { isCorrect: true }, { isCorrect: true }, { isCorrect: false }]);
    });

    const result = await service.getLeaderboard();

    expect(result[0].userId).toBe('u2');
    expect(result[1].userId).toBe('u1');
  });
});
