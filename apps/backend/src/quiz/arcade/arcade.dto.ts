import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, Max, Min, ValidateNested } from 'class-validator';

class PatternRoundDto {
  @IsInt() @Min(3) @Max(5) grid!: number;
  @IsInt() @Min(1) @Max(25) length!: number;
  @IsInt() @Min(0) @Max(60000) ms!: number;
}

export class SubmitPatternMapDto {
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => PatternRoundDto)
  rounds!: PatternRoundDto[];

  @IsInt() @Min(0) @Max(5000) clicks!: number;
  @IsInt() @Min(0) @Max(5000) correctClicks!: number;
}
