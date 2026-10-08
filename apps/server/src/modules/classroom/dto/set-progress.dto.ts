import { IsBoolean } from 'class-validator'

export class SetProgressDto {
  @IsBoolean()
  completed!: boolean
}
