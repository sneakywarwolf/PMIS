import { IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';

export class AnswerQuizQuestionDto {
  @IsString()
  @IsNotEmpty()
  questionId!: string;

  @IsInt()
  @Min(0)
  @Max(3)
  selectedOption!: number;
}
