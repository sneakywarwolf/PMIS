import { Test } from '@nestjs/testing';
import { QuizService } from './quiz.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

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
