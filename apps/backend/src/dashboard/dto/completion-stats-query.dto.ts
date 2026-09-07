import { IsIn, IsOptional, IsString } from 'class-validator';

export type CompletionStatsScope = 'self' | 'team' | 'org';
export type CompletionStatsGranularity = 'week' | 'month' | 'quarter';

export class CompletionStatsQueryDto {
  @IsIn(['self', 'team', 'org'])
  scope: CompletionStatsScope;

  @IsIn(['week', 'month', 'quarter'])
  granularity: CompletionStatsGranularity;

  @IsOptional()
  @IsString()
  tlId?: string;
}
