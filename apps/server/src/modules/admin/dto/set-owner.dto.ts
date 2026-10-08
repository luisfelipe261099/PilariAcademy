import { IsString, MinLength } from 'class-validator'

export class SetOwnerDto {
  @IsString()
  @MinLength(1)
  instructorId!: string
}
