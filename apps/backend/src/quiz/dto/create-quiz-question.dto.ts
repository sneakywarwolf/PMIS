import { ArrayMaxSize, ArrayMinSize, IsDateString, IsInt, IsString, Max, Min, MinLength } from 'class-validator';

export class CreateQuizQuestionDto {
  @IsString()
  @MinLength(1)
  question!: string;

  @ArrayMinSize(4)
  @ArrayMaxSize(4)
  @IsString({ each: true })
  options!: string[];

  @IsInt()
  @Min(0)
  @Max(3)
  correctIndex!: number;

  @IsString()
  @MinLength(1)
  explanation!: string;

  @IsDateString()
  scheduledFor!: string;
}
