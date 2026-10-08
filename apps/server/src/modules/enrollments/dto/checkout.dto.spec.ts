/// <reference types="jest" />
import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CartSummaryDto, CheckoutDto } from './checkout.dto'

async function courseIdsErrors(dtoClass: typeof CheckoutDto | typeof CartSummaryDto, courseIds: unknown): Promise<boolean> {
  const dto = plainToInstance(dtoClass, { courseIds })
  const errors = await validate(dto)
  return errors.some((e) => e.property === 'courseIds')
}

describe.each([
  ['CheckoutDto', CheckoutDto],
  ['CartSummaryDto', CartSummaryDto],
] as const)('%s.courseIds', (_name, dtoClass) => {
  it('aceita um carrinho normal', async () => {
    expect(await courseIdsErrors(dtoClass, ['id-1', 'id-2'])).toBe(false)
  })

  it('rejeita carrinho vazio', async () => {
    expect(await courseIdsErrors(dtoClass, [])).toBe(true)
  })

  it('rejeita mais de 50 itens (anti-DoS no inArray)', async () => {
    expect(await courseIdsErrors(dtoClass, Array.from({ length: 51 }, (_, i) => `id-${i}`))).toBe(true)
    expect(await courseIdsErrors(dtoClass, Array.from({ length: 50 }, (_, i) => `id-${i}`))).toBe(false)
  })

  it('rejeita ID maior que a coluna (varchar 36)', async () => {
    expect(await courseIdsErrors(dtoClass, ['x'.repeat(37)])).toBe(true)
    expect(await courseIdsErrors(dtoClass, ['x'.repeat(36)])).toBe(false)
  })

  it('rejeita ID vazio', async () => {
    expect(await courseIdsErrors(dtoClass, [''])).toBe(true)
  })
})

describe('couponCode', () => {
  it('rejeita código acima de 64 chars (máximo real é 40)', async () => {
    const dto = plainToInstance(CartSummaryDto, { courseIds: ['id-1'], couponCode: 'x'.repeat(65) })
    expect((await validate(dto)).some((e) => e.property === 'couponCode')).toBe(true)
  })

  it('aceita código normal', async () => {
    const dto = plainToInstance(CartSummaryDto, { courseIds: ['id-1'], couponCode: 'BEMVINDO10' })
    expect(await validate(dto)).toHaveLength(0)
  })
})
