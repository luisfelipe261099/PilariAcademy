import { validateHeaderValue } from 'node:http'
import { dispositionInline } from './content-disposition'

describe('dispositionInline', () => {
  it.each(['Apostila 1 — Antes de começar.pdf', 'Diário de prática (para imprimir).pdf', 'Ficha 🧘 ponte.pdf', 'simples.pdf'])(
    'o Node aceita o cabeçalho de %s',
    (nome) => {
      expect(() => validateHeaderValue('Content-Disposition', dispositionInline(nome))).not.toThrow()
    }
  )
  it('nome original vai em UTF-8 e a reserva em ASCII', () => {
    expect(dispositionInline('Apostila 1 — Antes de começar.pdf')).toBe(
      `inline; filename="Apostila 1 - Antes de comecar.pdf"; filename*=UTF-8''Apostila%201%20%E2%80%94%20Antes%20de%20come%C3%A7ar.pdf`
    )
  })
  it('aspas, barra invertida e quebra de linha não entram (sem injeção de cabeçalho)', () => {
    const h = dispositionInline('a"b\\c\r\nX-Evil: 1.pdf')
    expect(h).not.toMatch(/[\r\n]/)
    expect(h.startsWith('inline; filename="abcX-Evil: 1.pdf"')).toBe(true)
  })
  it('parênteses e apóstrofo vão codificados no filename*', () => {
    expect(dispositionInline("d'a(b).pdf")).toContain("filename*=UTF-8''d%27a%28b%29.pdf")
  })
})
