import { describe, expect, it } from 'vitest'
import { FIRST_APPROVAL_WARNING, logOriginLabel, workloadLabel } from './labels'

describe('workloadLabel', () => {
  it('carga que o polo definiu: só as horas', () => {
    expect(workloadLabel({ workloadHours: 40, workloadIsComputed: false })).toBe('40 h')
  })
  it('carga que vem da soma das aulas: avisa de onde veio', () => {
    expect(workloadLabel({ workloadHours: 12, workloadIsComputed: true })).toBe('12 h (soma das aulas)')
  })
})

describe('FIRST_APPROVAL_WARNING', () => {
  it('diz o que a primeira aprovação trava para o polo', () => {
    expect(FIRST_APPROVAL_WARNING).toBe('Ao aprovar, título, carga horária, coordenador e assinatura ficam travados para o polo.')
  })
})

describe('logOriginLabel', () => {
  it('registro de um polo mostra o nome do polo', () => {
    expect(logOriginLabel({ tenantId: 't1', tenantName: 'Polo Centro' })).toBe('Polo Centro')
  })
  it('registro global (sem polo) é da Plataforma', () => {
    expect(logOriginLabel({ tenantId: null, tenantName: null })).toBe('Plataforma')
  })
  it('polo que já não existe não passa por ação da Plataforma', () => {
    expect(logOriginLabel({ tenantId: 't9', tenantName: null })).toBe('Polo removido')
  })
})
