import { Test } from '@nestjs/testing';
import { QuizController } from './quiz.controller';
import { QuizService } from './quiz.service';

describe('QuizController', () => {
  let controller: QuizController;
  let service: Partial<Record<keyof QuizService, jest.Mock>>;

  beforeEach(async () => {
    service = {
      getTodayQuestion: jest.fn(),
      submitAnswer: jest.fn(),
      getLog: jest.fn(),
      getLogEntry: jest.fn(),
      getScorecard: jest.fn(),
      getLeaderboard: jest.fn(),
      createQuestion: jest.fn(),
      updateQuestion: jest.fn(),
      listQuestions: jest.fn(),
      getQuestionResponses: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [QuizController],
      providers: [{ provide: QuizService, useValue: service }],
    }).compile();
    controller = moduleRef.get(QuizController);
  });

  it('getToday delegates to service with the current user id', async () => {
    (service.getTodayQuestion as jest.Mock).mockResolvedValue({ id: 'q1' });

    const result = await controller.getToday('u1');

    expect(service.getTodayQuestion).toHaveBeenCalledWith('u1');
    expect(result).toEqual({ id: 'q1' });
  });

  it('answerToday delegates questionId, userId, and selectedOption', async () => {
    (service.submitAnswer as jest.Mock).mockResolvedValue({ id: 'a1' });

    await controller.answerToday('u1', { questionId: 'q1', selectedOption: 2 } as any);

    expect(service.submitAnswer).toHaveBeenCalledWith('u1', 'q1', 2);
  });

  it('createQuestion delegates admin id, dto, ipAddress, userAgent', async () => {
    (service.createQuestion as jest.Mock).mockResolvedValue({ id: 'q1' });
    const dto = {
      question: 'Q',
      options: ['a', 'b', 'c', 'd'],
      correctIndex: 0,
      explanation: 'E',
      scheduledFor: '2026-09-10T00:00:00.000Z',
    };
    const req = { ip: '1.2.3.4', headers: { 'user-agent': 'jest' } };

    await controller.createQuestion('admin-1', dto as any, req as any);

    expect(service.createQuestion).toHaveBeenCalledWith('admin-1', dto, '1.2.3.4', 'jest');
  });
});
