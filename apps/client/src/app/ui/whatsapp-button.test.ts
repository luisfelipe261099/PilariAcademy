import { describe, expect, it } from 'vitest'
import { mostraWhatsApp } from './WhatsAppButton'

describe('mostraWhatsApp', () => {
  it('some na sala de aula e na página do tutor (lá o botão flutuante é o da IA)', () => {
    expect(mostraWhatsApp('/aprender/gestao-rh')).toBe(false)
    expect(mostraWhatsApp('/aprender/gestao-rh/tutor')).toBe(false)
  })

  it('continua no resto do site', () => {
    for (const p of ['/', '/curso/gestao-rh', '/carrinho', '/dashboard', '/minha-conta', '/aprender']) expect(mostraWhatsApp(p)).toBe(true)
  })
})
