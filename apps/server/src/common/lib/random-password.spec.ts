/// <reference types="jest" />
import { randomPassword } from './random-password'

describe('randomPassword', () => {
  it('sempre leva minúscula, maiúscula, dígito e símbolo, em 36 caracteres', () => {
    for (let i = 0; i < 500; i++) {
      const senha = randomPassword()
      expect(senha).toHaveLength(36)
      expect(senha).toMatch(/[a-z]/)
      expect(senha).toMatch(/[A-Z]/)
      expect(senha).toMatch(/[0-9]/)
      expect(senha).toMatch(/[^A-Za-z0-9]/)
    }
  })

  it('o fim da senha garante as quatro classes mesmo quando o trecho aleatório sai sem nenhuma delas', () => {
    // Piores casos do base64url: 24 bytes 0x00 viram 32 "A" (só maiúscula) e 24 bytes 0xff viram 32 "_" (só símbolo).
    for (const bytes of [Buffer.alloc(24, 0x00), Buffer.alloc(24, 0xff)]) {
      const senha = randomPassword(bytes)
      expect(senha.slice(0, 32)).toBe(bytes.toString('base64url'))
      expect(senha.slice(32)).toMatch(/^[a-z][A-Z][0-9][!@#$%&*?]$/)
    }
  })

  it('não se repete e só usa caracteres que passam em qualquer formulário (ASCII, sem espaço, aspas ou barra invertida)', () => {
    const senhas = Array.from({ length: 500 }, () => randomPassword())
    expect(new Set(senhas).size).toBe(500)
    for (const senha of senhas) expect(senha).toMatch(/^[A-Za-z0-9_\-!@#$%&*?]+$/)
  })

  it('o símbolo do fim varia entre os aceitos pela política de senha do Firebase', () => {
    const simbolos = new Set(Array.from({ length: 500 }, () => randomPassword().slice(-1)))
    expect([...simbolos].every((s) => '!@#$%&*?'.includes(s))).toBe(true)
    expect(simbolos.size).toBeGreaterThan(1)
  })
})
