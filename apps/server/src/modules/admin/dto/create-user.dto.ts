import { ArrayNotEmpty, IsArray, IsEmail, IsEnum, IsNotEmpty, IsString, MinLength } from 'class-validator'
import { Role } from '@pilari/types'

export class CreateUserDto {
  @IsEmail()
  email!: string

  @IsString()
  @IsNotEmpty()
  displayName!: string

  @IsString()
  @MinLength(6)
  password!: string

  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(Role, { each: true })
  roles!: Role[]
}
