import { describe, expect, it } from 'vitest'
import { installmentLabel, maxInstallmentsFor } from './installments'

describe('installments', () => {
  it('usa piso de R$ 10 no boleto e R$ 5 no cartão', () => {
    // O piso do Asaas é R$ 5,00 no cartão e R$ 10,00 no boleto. A v1 do design usava
    // R$ 5,00 para os dois e prometeria parcelas que o Asaas recusa.
    expect(maxInstallmentsFor(4000, 'boleto_parcelado')).toBe(4) // R$ 40 → 4x de R$ 10
    expect(maxInstallmentsFor(4000, 'cartao_parcelado')).toBe(8) // R$ 40 → 8x de R$ 5
  })

  it('respeita o teto de 5 no boleto e 10 no cartão', () => {
    expect(maxInstallmentsFor(500000, 'boleto_parcelado')).toBe(5)
    expect(maxInstallmentsFor(500000, 'cartao_parcelado')).toBe(10)
  })

  it('devolve null quando não dá nem 2x', () => {
    expect(installmentLabel(1500, 'boleto_parcelado')).toBeNull() // R$ 15 → 1x de R$ 10
  })

  it('formata o rótulo do boleto', () => {
    expect(installmentLabel(50000, 'boleto_parcelado')).toBe('até 5x de R$ 100,00')
  })

  it('formata o rótulo do cartão e respeita o arredondamento para cima', () => {
    expect(installmentLabel(549700, 'cartao_parcelado')).toBe('até 10x de R$ 549,70')
    expect(installmentLabel(10001, 'cartao_parcelado')).toBe('até 10x de R$ 10,01')
  })

  it('à vista nunca parcela', () => {
    expect(maxInstallmentsFor(1000000, 'avista')).toBe(1)
    expect(installmentLabel(1000000, 'avista')).toBeNull()
  })

  it('total zero ou negativo não permite parcelar', () => {
    expect(installmentLabel(0, 'boleto_parcelado')).toBeNull()
    expect(installmentLabel(0, 'cartao_parcelado')).toBeNull()
    // O nome do teste prometia o caso negativo e não o exercia. Total negativo não
    // deveria existir, mas se um cupom mal calculado produzir um, a tela não pode
    // oferecer parcelamento em cima dele.
    expect(installmentLabel(-500, 'boleto_parcelado')).toBeNull()
    expect(maxInstallmentsFor(-500, 'boleto_parcelado')).toBe(1)
  })
})
