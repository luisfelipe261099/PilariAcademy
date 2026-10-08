import { Transform } from 'class-transformer'
import { IsEmail, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, Length, Matches, ValidateIf } from 'class-validator'
import type { TenantBrandingInput, TenantStatus } from '@pilari/types'

// Toda regra daqui declara a própria mensagem, em português: o texto padrão do class-validator é em inglês e iria direto
// para o console. O `platform.dto.spec` confere regra por regra.

/**
 * Campo que pode faltar no PATCH, mas não pode vir `null`. O @IsOptional() deixa o `null` passar sem validar, e o
 * serviço não o espera: `name: null` estouraria no trim() e `status: null` gravaria NULL numa coluna NOT NULL (500).
 */
const OpcionalSemNulo = () => ValidateIf((_objeto: unknown, valor: unknown) => valor !== undefined)

/** Apara o texto antes de validar (e antes de o controller recebê-lo): "   " e " A " não valem como nome. */
const Aparado = () => Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))

export class CreateTenantDto {
  @IsString({ message: 'Informe o endereço do polo.' })
  @Matches(/^[a-z0-9-]{3,40}$/, { message: 'Endereço do polo: use de 3 a 40 letras minúsculas, números e hífen.' })
  slug!: string
  @IsString({ message: 'Informe o nome do polo.' }) @Length(2, 160, { message: 'Informe o nome do polo (2 a 160 caracteres).' }) name!: string
  @IsOptional() @IsObject({ message: 'Marca do polo inválida.' }) branding?: TenantBrandingInput
  @IsEmail({}, { message: 'E-mail do admin inválido.' }) firstAdminEmail!: string
  @Aparado()
  @IsString({ message: 'Informe o nome do admin.' })
  @Length(2, 120, { message: 'Informe o nome do admin (2 a 120 caracteres).' })
  firstAdminName!: string
}

export class UpdateTenantDto {
  @OpcionalSemNulo() @IsString({ message: 'Informe o nome do polo.' }) @Length(2, 160, { message: 'Informe o nome do polo (2 a 160 caracteres).' }) name?: string
  @OpcionalSemNulo() @IsIn(['active', 'suspended'], { message: 'Situação do polo inválida: use "active" ou "suspended".' }) status?: TenantStatus
  @OpcionalSemNulo() @IsObject({ message: 'Marca do polo inválida.' }) branding?: TenantBrandingInput
}

export class AddTenantAdminDto {
  @IsEmail({}, { message: 'E-mail inválido.' }) email!: string
  @Aparado()
  @IsString({ message: 'Informe o nome do admin.' })
  @Length(2, 120, { message: 'Informe o nome do admin (2 a 120 caracteres).' })
  name!: string
}

export class AddDomainDto {
  @IsString({ message: 'Informe o domínio.' }) @Length(4, 253, { message: 'Informe o domínio (4 a 253 caracteres).' }) host!: string
}

export class ReviewNoteDto {
  // O tamanho do motivo (3 a 1000 caracteres) é conferido pelo serviço, com este mesmo texto.
  @IsString({ message: 'Escreva o motivo (3 a 1000 caracteres).' }) note!: string
}

/** Aprovação: a versão do curso que o revisor conferiu na fila (`ReviewQueueItem.fingerprint`). */
export class ApproveCourseDto {
  @IsString({ message: 'Recarregue a fila de aprovação e confira o curso antes de aprovar.' })
  @IsNotEmpty({ message: 'Recarregue a fila de aprovação e confira o curso antes de aprovar.' })
  fingerprint!: string
}
