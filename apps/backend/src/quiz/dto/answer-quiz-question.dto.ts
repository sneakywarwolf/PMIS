import { IsInt, Max, Min } from 'class-validator';

export class AnswerQuizQuestionDto {
  @IsInt()
  @Min(0)
  @Max(3)
  selectedOption!: number;
}
