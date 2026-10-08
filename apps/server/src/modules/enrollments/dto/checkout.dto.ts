import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator'
import type { PaymentMode } from '@pilari/types'

// Limites do carrinho: no máximo 50 itens (o catálogo inteiro cabe com folga) e cada ID no
// tamanho da coluna (varchar 36). couponCode limitado com folga sobre o máximo real (40).
// Barra payloads gigantes nos endpoints públicos antes de chegarem ao inArray() do banco.
export class CheckoutDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Length(1, 36, { each: true })
  courseIds!: string[]

  @IsOptional()
  @IsString()
  @MaxLength(64)
  couponCode?: string

  @IsOptional()
  @IsString()
  @Length(11, 14)
  cpf?: string

  /** Como o aluno escolheu pagar. Ausente = 'avista'. */
  @IsOptional()
  @IsIn(['avista', 'cartao_parcelado', 'boleto_parcelado'])
  paymentMode?: PaymentMode

  /** Parcelas do carnê. Só faz sentido com paymentMode 'boleto_parcelado'. */
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(5)
  installmentCount?: number
}

export class CartSummaryDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Length(1, 36, { each: true })
  courseIds!: string[]

  @IsOptional()
  @IsString()
  @MaxLength(64)
  couponCode?: string
}
