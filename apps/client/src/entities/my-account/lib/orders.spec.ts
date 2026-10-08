import { describe, expect, it } from 'vitest'
import type { MyOrder } from '@pilari/types'
import { canDownloadCertificate, canPay, carneProgress, formatDateOnly, orderStatusLabel, paymentModeLabel } from './orders'

const base: MyOrder = {
  id: 'o1', status: 'pending', totalInCents: 79990, paymentMode: 'avista', billingType: null,
  paymentUrl: 'https://asaas/i/1', dueDate: '2026-09-10', paidAt: null, createdAt: null,
  courseTitles: [], installments: [], settledAt: null, carneUrl: null,
}

describe('canPay', () => {
  it('pendente com link → pode pagar', () => {
    expect(canPay(base)).toBe(true)
  })
  it('CANCELADO com link ainda vivo → NÃO pode pagar', () => {
    // O link do Asaas continua acessível depois do cancelamento: sem o teste de status,
    // o aluno pagaria um boleto de uma compra que já não vale.
    expect(canPay({ ...base, status: 'canceled' })).toBe(false)
  })
  it('pago → nada a pagar', () => {
    expect(canPay({ ...base, status: 'paid' })).toBe(false)
  })
  it('pendente sem link → não oferece botão que não leva a lugar nenhum', () => {
    expect(canPay({ ...base, paymentUrl: null })).toBe(false)
  })
})

describe('carneProgress', () => {
  it('sem parcelas → null (não é carnê)', () => {
    expect(carneProgress(base)).toBeNull()
  })
  it('conta só as pagas', () => {
    const p = carneProgress({
      ...base,
      installments: [
        { installmentNumber: 1, valueInCents: 100, status: 'paid', dueDate: null, paidAt: null },
        { installmentNumber: 2, valueInCents: 100, status: 'overdue', dueDate: null, paidAt: null },
        { installmentNumber: 3, valueInCents: 100, status: 'pending', dueDate: null, paidAt: null },
      ],
    })
    expect(p).toEqual({ pagas: 1, total: 3, quitado: false })
  })
})

describe('formatDateOnly', () => {
  it('não desloca o dia por fuso — boleto do dia 10 não pode virar 09', () => {
    expect(formatDateOnly('2026-09-10')).toBe('10/09/2026')
  })
  it('aceita timestamp e usa só a data', () => {
    expect(formatDateOnly('2026-09-10T23:30:00.000Z')).toBe('10/09/2026')
  })
  it('nulo → travessão', () => {
    expect(formatDateOnly(null)).toBe('—')
  })
})

describe('rótulos', () => {
  it('status do pedido em português', () => {
    expect(orderStatusLabel('pending')).toMatch(/aguardando/i)
    expect(orderStatusLabel('paid')).toBe('Pago')
  })
  it('pedido antigo sem modo gravado não inventa "À vista"', () => {
    expect(paymentModeLabel(null)).toBe('—')
    expect(paymentModeLabel('boleto_parcelado')).toMatch(/carnê/i)
  })
})

describe('canDownloadCertificate', () => {
  it('revogado não baixa', () => {
    expect(canDownloadCertificate({ code: 'A', courseSlug: 's', courseTitle: 't', hours: 2, issuedAt: null, status: 'revoked' })).toBe(false)
    expect(canDownloadCertificate({ code: 'A', courseSlug: 's', courseTitle: 't', hours: 2, issuedAt: null, status: 'issued' })).toBe(true)
  })
})
