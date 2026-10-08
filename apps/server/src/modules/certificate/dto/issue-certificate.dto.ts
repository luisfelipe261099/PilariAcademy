import { IsOptional, IsString, Validate, ValidatorConstraint, type ValidatorConstraintInterface } from 'class-validator'
import { isValidCpf } from '../../../common/cpf'

/** CPF com os dígitos verificadores certos, com ou sem máscara (a mesma regra do cadastro: `isValidCpf`). */
@ValidatorConstraint({ name: 'cpfValido', async: false })
export class CpfValido implements ValidatorConstraintInterface {
  validate(valor: unknown): boolean {
    return typeof valor === 'string' && isValidCpf(valor)
  }

  defaultMessage(): string {
    return 'CPF inválido.'
  }
}

/**
 * Corpo da emissão sem requisitos (`POST /admin/students/:uid/courses/:courseId/certificate`). Os dois campos são
 * opcionais: sem eles, valem o nome e o CPF do cadastro do aluno. O CPF informado vai para o certificado e, se o
 * cadastro não tiver, para o cadastro: por isso é validado aqui, e não só convertido em dígitos lá dentro.
 */
export class IssueCertificateAsAdminDto {
  @IsOptional() @IsString({ message: 'Informe o nome do aluno como texto.' }) nome?: string
  @IsOptional() @IsString({ message: 'CPF inválido.' }) @Validate(CpfValido, { message: 'CPF inválido.' }) cpf?: string
}
