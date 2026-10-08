import { describe, expect, it } from 'vitest'
import { courseChangedNotice, tenantAdminMessage, tenantSlugError } from './messages'

describe('tenantSlugError', () => {
  it('aceita endereço válido', () => {
    expect(tenantSlugError('polo-centro')).toBeNull()
  })
  it('aceita os limites de 3 e de 40 caracteres e endereço só com números', () => {
    for (const s of ['abc', 'a'.repeat(40), '123', 'a-b']) expect(tenantSlugError(s)).toBeNull()
  })
  it('recusa maiúscula, espaço, hífen nas pontas e tamanho fora de 3 a 40', () => {
    const msg = 'Use de 3 a 40 letras minúsculas, números e hífen, sem hífen no começo ou no fim.'
    for (const s of ['Polo', 'polo centro', '-polo', 'polo-', 'ab', 'a'.repeat(41)]) expect(tenantSlugError(s)).toBe(msg)
  })
  it('recusa dois hífens seguidos, como o servidor, com a própria mensagem', () => {
    expect(tenantSlugError('polo--centro')).toBe('Não use dois hífens seguidos.')
  })
})

describe('tenantAdminMessage', () => {
  const admin = (over: { existingAccount: boolean; resetEmailSent: boolean }) => ({ uid: 'u', email: 'a@b.com', ...over })

  it('explica cada caso do primeiro admin', () => {
    expect(tenantAdminMessage(admin({ existingAccount: true, resetEmailSent: false }))).toBe('a@b.com já tinha conta na rede e entra com a senha de sempre.')
    expect(tenantAdminMessage(admin({ existingAccount: false, resetEmailSent: true }))).toBe('Enviamos para a@b.com o link para definir a senha.')
    expect(tenantAdminMessage(admin({ existingAccount: false, resetEmailSent: false }))).toBe(
      'A conta de a@b.com foi criada, mas o link de senha não saiu. Envie pela lista de usuários do polo, em Resetar senha.'
    )
  })

  // O servidor reenvia o link a quem tem conta mas nunca entrou (existingAccount e resetEmailSent juntos): dizer que a
  // pessoa "entra com a senha de sempre" seria mandá-la a uma senha aleatória que ninguém conhece.
  it('conta que já existia mas nunca entrou recebeu o link: a mensagem é a do link, não a da senha de sempre', () => {
    expect(tenantAdminMessage(admin({ existingAccount: true, resetEmailSent: true }))).toBe('Enviamos para a@b.com o link para definir a senha.')
  })
})

describe('courseChangedNotice', () => {
  const erro = (status: number, code: string | undefined, message: string) => ({ response: { status, data: { statusCode: status, ...(code ? { code } : {}), message } } })

  // O 409 chega depois de a fila já ter recarregado sozinha: "Recarregue" (a mensagem do servidor) mandaria fazer de novo o que já foi feito.
  it('409 COURSE_CHANGED: a fila já foi atualizada, então o aviso manda conferir e aprovar de novo', () => {
    const e = erro(409, 'COURSE_CHANGED', 'O curso mudou desde que a fila foi carregada. Recarregue e confira antes de aprovar.')
    expect(courseChangedNotice(e)).toBe('A fila foi atualizada: confira os dados e aprove de novo.')
  })
  it('qualquer outro erro não tem aviso próprio: a tela mostra a mensagem do servidor', () => {
    expect(courseChangedNotice(erro(400, 'INVALID_TRANSITION', 'O curso mudou de situação enquanto você decidia. Recarregue a página.'))).toBeNull()
    expect(courseChangedNotice(erro(409, undefined, 'Já existe um polo com este endereço.'))).toBeNull()
    expect(courseChangedNotice(new Error('Network Error'))).toBeNull()
    expect(courseChangedNotice(null)).toBeNull()
  })
})
