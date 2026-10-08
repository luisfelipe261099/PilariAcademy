import { describe, expect, it } from 'vitest'
import type { OrderSettlement } from '@pilari/types'
import { carneBlockedInfo } from './settlement'

function settlement(over: Partial<OrderSettlement>): OrderSettlement {
  return { settled: false, paidCount: 0, totalCount: 0, carneUrl: null, ...over }
}

describe('carneBlockedInfo', () => {
  it('nada a avisar quando ainda não carregou', () => {
    expect(carneBlockedInfo(undefined)).toBeNull()
  })

  it('nada a avisar quando o carnê está quitado', () => {
    expect(carneBlockedInfo(settlement({ settled: true, paidCount: 5, totalCount: 5, carneUrl: '/me/orders/1/carne' }))).toBeNull()
  })

  it('nada a avisar quando o pedido não é carnê (sem carneUrl)', () => {
    expect(carneBlockedInfo(settlement({ settled: false, carneUrl: null }))).toBeNull()
  })

  it('avisa com a contagem de parcelas faltantes e devolve o carneUrl', () => {
    const info = carneBlockedInfo(settlement({ settled: false, paidCount: 2, totalCount: 5, carneUrl: '/me/orders/42/carne' }))
    expect(info).toEqual({
      message: 'Certificado bloqueado: faltam 3 de 5 parcelas do carnê para quitar.',
      carneUrl: '/me/orders/42/carne',
    })
  })

  it('usa singular quando só falta 1 parcela de um total de 1', () => {
    const info = carneBlockedInfo(settlement({ settled: false, paidCount: 0, totalCount: 1, carneUrl: '/me/orders/9/carne' }))
    expect(info?.message).toBe('Certificado bloqueado: falta 1 de 1 parcela do carnê para quitar.')
  })

  it('o verbo concorda com o que FALTA, não com o total', () => {
    // 1 de 5: o substantivo é plural ("parcelas") mas o verbo tem que ser singular.
    const info = carneBlockedInfo(settlement({ settled: false, paidCount: 4, totalCount: 5, carneUrl: '/me/orders/9/carne' }))
    expect(info?.message).toBe('Certificado bloqueado: falta 1 de 5 parcelas do carnê para quitar.')
  })

  it('mensagem genérica quando a contagem não indica parcela faltante (defensivo)', () => {
    const info = carneBlockedInfo(settlement({ settled: false, paidCount: 5, totalCount: 5, carneUrl: '/me/orders/7/carne' }))
    expect(info?.message).toBe('Certificado bloqueado: pagamento do carnê pendente.')
  })
})
