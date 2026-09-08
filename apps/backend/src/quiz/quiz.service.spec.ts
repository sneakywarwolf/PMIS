import { Test } from '@nestjs/testing';
import { QuizService } from './quiz.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BadRequestException, ConflictException } from '@nestjs/common';

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
    prisma.quizQuestion.findUnique.mockResolvedValue({ id: 'q1', status: 'ACTIVE', correctIndex: 0 });
    prisma.quizAttempt.findUnique.mockResolvedValue({ id: 'existing-attempt' });

    await expect(service.submitAnswer('u1', 'q1', 0)).rejects.toThrow(ConflictException);
  });

  it('awards base points and increments streak on a correct answer', async () => {
    prisma.quizQuestion.findUnique.mockResolvedValue({ id: 'q1', status: 'ACTIVE', correctIndex: 2 });
    prisma.quizAttempt.findUnique.mockResolvedValue(null);
    prisma.quizUserStats.findUnique.mockResolvedValue({
      userId: 'u1',
      totalPoints: 0,
      currentStreak: 0,
      bestStreak: 0,
      lastAnsweredOn: null,
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
    prisma.quizQuestion.findUnique.mockResolvedValue({ id: 'q1', status: 'ACTIVE', correctIndex: 2 });
    prisma.quizAttempt.findUnique.mockResolvedValue(null);
    prisma.quizUserStats.findUnique.mockResolvedValue({
      userId: 'u1',
      totalPoints: 20,
      currentStreak: 3,
      bestStreak: 3,
      lastAnsweredOn: new Date(),
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
});
