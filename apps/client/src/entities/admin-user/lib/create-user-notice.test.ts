import { describe, expect, it } from 'vitest'
import { createUserNotice } from './create-user-notice'

describe('createUserNotice', () => {
  it('e-mail que já tinha conta na rede: avisa que a senha digitada não valeu', () => {
    expect(createUserNotice({ existingAccount: true })).toBe(
      'Esta pessoa já tinha conta na rede e entra com a senha que já usa. A senha digitada não foi usada.'
    )
  })
  it('conta nova: sem aviso', () => {
    expect(createUserNotice({ existingAccount: false })).toBeNull()
  })
  it('sem resposta ainda ou servidor antigo sem o campo: sem aviso', () => {
    expect(createUserNotice(undefined)).toBeNull()
    expect(createUserNotice({} as { existingAccount: boolean })).toBeNull()
  })
})
