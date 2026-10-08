import { ArrayMinSize, IsArray, IsInt, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, Max, Min } from 'class-validator'

export class CreateQuestionDto {
  @IsString() @IsNotEmpty() prompt!: string
  @IsArray() @ArrayMinSize(2) @IsString({ each: true }) options!: string[]
  @IsInt() @Min(0) correctIndex!: number
  @IsOptional() @IsNumber() @Min(0) @Max(10) points?: number
}

export class UpdateQuestionDto {
  @IsOptional() @IsString() prompt?: string
  @IsOptional() @IsArray() @ArrayMinSize(2) @IsString({ each: true }) options?: string[]
  @IsOptional() @IsInt() @Min(0) correctIndex?: number
  @IsOptional() @IsNumber() @Min(0) @Max(10) points?: number
}

export class SubmitQuizDto {
  @IsObject() answers!: Record<string, number>
}
