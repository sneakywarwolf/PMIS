import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateQuizQuestionDto } from './create-quiz-question.dto';

function validQuestion() {
  return {
    question: 'What does XSS stand for?',
    options: ['Cross-Site Scripting', 'X-Server Script', 'Extended Style Sheet', 'XML Site Sync'],
    correctIndex: 0,
    explanation: 'XSS is Cross-Site Scripting, a client-side injection vulnerability.',
    scheduledFor: '2026-09-10T09:00:00.000Z',
  };
}

describe('CreateQuizQuestionDto', () => {
  it('accepts a valid question', async () => {
    const dto = plainToInstance(CreateQuizQuestionDto, validQuestion());
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects fewer than 4 options', async () => {
    const dto = plainToInstance(CreateQuizQuestionDto, { ...validQuestion(), options: ['a', 'b', 'c'] });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'options')).toBe(true);
  });

  it('rejects more than 4 options', async () => {
    const dto = plainToInstance(CreateQuizQuestionDto, { ...validQuestion(), options: ['a', 'b', 'c', 'd', 'e'] });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'options')).toBe(true);
  });

  it('rejects correctIndex outside 0-3', async () => {
    const dto = plainToInstance(CreateQuizQuestionDto, { ...validQuestion(), correctIndex: 4 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'correctIndex')).toBe(true);
  });

  it('rejects a missing question text', async () => {
    const dto = plainToInstance(CreateQuizQuestionDto, { ...validQuestion(), question: '' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'question')).toBe(true);
  });
});
