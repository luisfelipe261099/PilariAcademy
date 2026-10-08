import { describe, it, expect } from 'vitest'
import { formatPriceBRL, formatMoneyBRL } from './format-price'

describe('formatPriceBRL', () => {
  it('formata centavos como reais', () => {
    expect(formatPriceBRL(9700)).toBe('R$ 97,00')
  })
  it('formata valores com milhar', () => {
    expect(formatPriceBRL(549700)).toBe('R$ 5.497,00')
  })
  it('preço 0 vira "Grátis"', () => {
    expect(formatPriceBRL(0)).toBe('Grátis')
  })
})

describe('formatMoneyBRL', () => {
  it('zero vira "R$ 0,00" (não "Grátis")', () => {
    expect(formatMoneyBRL(0)).toBe('R$ 0,00')
  })
  it('formata valor normal', () => {
    expect(formatMoneyBRL(19700)).toBe('R$ 197,00')
  })
})
