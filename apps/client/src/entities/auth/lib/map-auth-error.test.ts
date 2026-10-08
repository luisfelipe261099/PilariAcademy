import { describe, it, expect } from 'vitest'
import { mapAuthError } from './map-auth-error'

describe('mapAuthError', () => {
  it('credencial inválida', () => {
    expect(mapAuthError('auth/invalid-credential')).toBe('E-mail ou senha incorretos.')
  })
  it('e-mail já em uso', () => {
    expect(mapAuthError('auth/email-already-in-use')).toBe('Este e-mail já está cadastrado. Tente entrar.')
  })
  it('senha fraca', () => {
    expect(mapAuthError('auth/weak-password')).toBe('A senha deve ter pelo menos 6 caracteres.')
  })
  it('fallback para código desconhecido', () => {
    expect(mapAuthError('auth/qualquer')).toBe('Não foi possível concluir. Tente novamente.')
  })
})
