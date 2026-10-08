import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator'

/**
 * Cobrança criada pelo admin. `courseIds` vazio = avulsa, e aí `description` e
 * `amountInCents` são obrigatórios (validado no service, que é quem conhece a regra).
 */
export class CreateChargeDto {
  @IsString() @IsNotEmpty() userId!: string
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) courseIds?: string[]
  @IsOptional() @IsString() @MaxLength(200) description?: string
  // Centavos: o valor NUNCA trafega como float, senão 199,90 vira 199.89999.
  @IsOptional() @IsInt() @Min(1) amountInCents?: number
  @IsOptional() @IsInt() @Min(1) @Max(5) installmentCount?: number
  /** Só quando o aluno ainda não tem CPF no cadastro. Aceita com ou sem pontuação. */
  @IsOptional() @IsString() @Length(11, 14) cpf?: string
  /** Libera o acesso já, sem esperar o pagamento. */
  @IsOptional() @IsBoolean() enrollNow?: boolean
  /** Vencimento AAAA-MM-DD. No carnê, o da primeira parcela. */
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Vencimento deve ser AAAA-MM-DD.' })
  dueDate?: string
}
