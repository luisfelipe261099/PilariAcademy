import { describe, it, expect } from 'vitest'
import { formatDueDate } from './format-due-date'

describe('formatDueDate', () => {
  it('não perde 1 dia por fuso: data-pura YYYY-MM-DD nunca passa por new Date()', () => {
    // new Date('2026-01-10') é interpretado como UTC-meia-noite; em America/Sao_Paulo
    // (UTC-3) isso vira 09/01 — o dia anterior. formatDueDate não pode reproduzir esse bug.
    expect(formatDueDate('2026-01-10')).toBe('10/01/26')
  })

  it('vencimento no fim/início do mês/ano não escorrega', () => {
    expect(formatDueDate('2026-12-31')).toBe('31/12/26')
    expect(formatDueDate('2027-01-01')).toBe('01/01/27')
  })

  it('nulo vira travessão', () => {
    expect(formatDueDate(null)).toBe('—')
  })
})
