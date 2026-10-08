/// <reference types="jest" />
import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { CheckoutDto } from './dto/checkout.dto'

function validate(payload: Record<string, unknown>) {
  return validateSync(plainToInstance(CheckoutDto, payload), { whitelist: true, forbidNonWhitelisted: true })
}

describe('CheckoutDto', () => {
  it('aceita boleto_parcelado com 5 parcelas', () => {
    expect(validate({ courseIds: ['c1'], paymentMode: 'boleto_parcelado', installmentCount: 5, cpf: '12345678909' })).toHaveLength(0)
  })

  it('recusa paymentMode desconhecido', () => {
    // Sem @IsIn, enableImplicitConversion deixaria qualquer string passar e ela chegaria
    // ao AsaasService como modo inválido.
    expect(validate({ courseIds: ['c1'], paymentMode: 'pix_magico' }).length).toBeGreaterThan(0)
  })

  it('recusa installmentCount fora de 2..5', () => {
    expect(validate({ courseIds: ['c1'], paymentMode: 'boleto_parcelado', installmentCount: 6 }).length).toBeGreaterThan(0)
    expect(validate({ courseIds: ['c1'], paymentMode: 'boleto_parcelado', installmentCount: 1 }).length).toBeGreaterThan(0)
  })
})
