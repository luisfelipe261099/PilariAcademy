import { describe, it, expect } from 'vitest'
import { formatBillingType } from './format-billing-type'

describe('formatBillingType', () => {
  it('cartão parcelado mostra o número de parcelas', () => {
    expect(formatBillingType('CREDIT_CARD', 10)).toBe('Cartão · 10x')
  })

  it('cartão à vista não inventa "1x"', () => {
    expect(formatBillingType('CREDIT_CARD', null)).toBe('Cartão')
    expect(formatBillingType('CREDIT_CARD', 1)).toBe('Cartão')
  })

  it('boleto parcelado (carnê) também mostra as parcelas', () => {
    expect(formatBillingType('BOLETO', 10)).toBe('Boleto · 10x')
  })

  it('formata carnê de boleto', () => {
    expect(formatBillingType('BOLETO', 5)).toBe('Boleto · 5x')
  })

  it('Pix e formas conhecidas viram rótulo em português', () => {
    expect(formatBillingType('PIX', null)).toBe('Pix')
  })

  it('pedido ainda não pago (sem forma definida) vira travessão', () => {
    expect(formatBillingType(null, null)).toBe('—')
    expect(formatBillingType('UNDEFINED', null)).toBe('—')
  })

  it('forma desconhecida cai no valor cru em vez de sumir', () => {
    expect(formatBillingType('DEBIT_CARD', null)).toBe('DEBIT_CARD')
  })
})
