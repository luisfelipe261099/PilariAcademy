import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator'

export class UpsertReviewDto {
  @IsInt()
  @Min(1, { message: 'A nota deve ser de 1 a 5.' })
  @Max(5, { message: 'A nota deve ser de 1 a 5.' })
  rating!: number

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string
}

export class CreateNoteDto {
  @IsInt()
  @Min(0)
  atSec!: number

  @IsString()
  @MinLength(1, { message: 'A observação não pode ficar vazia.' })
  @MaxLength(2000)
  body!: string
}

export class CreateAnnouncementDto {
  @IsString()
  @MinLength(1, { message: 'O título é obrigatório.' })
  @MaxLength(200)
  title!: string

  @IsString()
  @MinLength(1, { message: 'O conteúdo é obrigatório.' })
  @MaxLength(5000)
  body!: string
}
