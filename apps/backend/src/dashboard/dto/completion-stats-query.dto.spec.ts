import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CompletionStatsQueryDto } from './completion-stats-query.dto';

describe('CompletionStatsQueryDto', () => {
  it('accepts valid self-scope payload no tlId', async () => {
    const dto = plainToInstance(CompletionStatsQueryDto, { scope: 'self', granularity: 'month' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts valid team-scope payload tlId', async () => {
    const dto = plainToInstance(CompletionStatsQueryDto, { scope: 'team', granularity: 'week', tlId: 'clx123' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects an invalid scope value', async () => {
    const dto = plainToInstance(CompletionStatsQueryDto, { scope: 'DROP TABLE projects', granularity: 'month' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('scope');
  });

  it('rejects an invalid granularity value', async () => {
    const dto = plainToInstance(CompletionStatsQueryDto, { scope: 'self', granularity: 'invalid' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('granularity');
  });

  it('rejects non-string tlId', async () => {
    const dto = plainToInstance(CompletionStatsQueryDto, { scope: 'self', granularity: 'month', tlId: 123 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('tlId');
  });

  it('accepts valid org-scope with quarter granularity', async () => {
    const dto = plainToInstance(CompletionStatsQueryDto, { scope: 'org', granularity: 'quarter', tlId: 'clx456' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
