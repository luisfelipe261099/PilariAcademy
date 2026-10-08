import { IsNotEmpty, IsString, MaxLength } from 'class-validator'

export class CreateCategoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string
}

export class UpdateCategoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string
}
