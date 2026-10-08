import { describe, expect, it } from 'vitest'
import { suspendedCopy } from './suspended'

describe('suspendedCopy', () => {
  it('polo ativo não mostra aviso', () => {
    expect(suspendedCopy({ name: 'Polo A', status: 'active' })).toBeNull()
  })
  it('polo suspenso explica que a sala de aula continua', () => {
    const c = suspendedCopy({ name: 'Polo A', status: 'suspended' })
    expect(c?.banner).toContain('Polo A')
    expect(c?.banner).toContain('Minha conta')
    expect(c?.catalog).toBe('O catálogo de Polo A está indisponível no momento.')
    expect(c?.courseTitle).toBe('Curso indisponível')
  })
})
