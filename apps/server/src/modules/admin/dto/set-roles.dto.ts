import { ArrayNotEmpty, IsArray, IsEnum } from 'class-validator'
import { Role } from '@pilari/types'

export class SetRolesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(Role, { each: true })
  roles!: Role[]
}
