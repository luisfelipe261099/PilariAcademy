import { describe, expect, it } from 'vitest'
import { quizLockedNotice } from './quiz-locked-notice'

describe('quizLockedNotice', () => {
  it('a matriz mantém o texto de sempre: procure a secretaria', () => {
    expect(quizLockedNotice(true)).toBe('Tentativas esgotadas — fale com o Studio Pilari para liberar novas tentativas.')
  })

  it('o polo manda falar com o professor do curso ou com o polo, nunca com a secretaria', () => {
    const texto = quizLockedNotice(false)
    expect(texto).toBe('Tentativas esgotadas — fale com o professor do curso ou com o seu polo para liberar novas tentativas.')
    expect(texto).not.toMatch(/secretaria/i)
  })
})
