import { IsOptional, IsString, MaxLength } from 'class-validator'

/** Edição do perfil do aluno pelo admin. Regras de nome e CPF ficam no AuthService. */
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayName?: string

  @IsOptional()
  @IsString()
  @MaxLength(14)
  cpf?: string
}
