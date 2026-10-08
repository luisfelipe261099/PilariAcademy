import { IsString, MinLength } from 'class-validator'

export class GrantEnrollmentDto {
  @IsString()
  @MinLength(1)
  courseId!: string
}
