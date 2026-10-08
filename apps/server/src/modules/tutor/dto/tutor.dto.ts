import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator'

export class TurnoTutorDto {
  @IsIn(['aluno', 'tutor']) role!: 'aluno' | 'tutor'
  @IsString() @MaxLength(2000) text!: string
}

export class PerguntaTutorDto {
  @IsString() @IsNotEmpty() moduleId!: string
  /** WAV PCM 16 bits mono em base64 (até ~60 s a 16 kHz). Ou isto ou `texto`. */
  @IsOptional() @IsString() @MaxLength(3_000_000) audioWavBase64?: string
  @IsOptional() @IsString() @MaxLength(1000) texto?: string
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => TurnoTutorDto) historico?: TurnoTutorDto[]
}

export class FalaTutorDto {
  @IsString() @IsNotEmpty() @MaxLength(1500) texto!: string
}
