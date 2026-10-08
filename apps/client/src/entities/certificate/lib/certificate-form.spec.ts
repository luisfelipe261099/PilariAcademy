import { describe, expect, it } from 'vitest'
import { blobErrorMessage, isValidFullName } from './certificate-form'

describe('isValidFullName', () => {
  it('aceita nome de pessoa', () => {
    expect(isValidFullName('Ana Maria Souza')).toBe(true)
  })
  it('recusa e-mail — foi exatamente o que vazou para dentro do documento', () => {
    expect(isValidFullName('aluno@exemplo.com')).toBe(false)
  })
  it('recusa vazio e espaços', () => {
    expect(isValidFullName('   ')).toBe(false)
  })
})

describe('blobErrorMessage', () => {
  it('extrai a mensagem do Nest de dentro do Blob', async () => {
    const data = new Blob([JSON.stringify({ statusCode: 400, message: 'Informe seu nome completo para emitir o certificado.' })])
    await expect(blobErrorMessage({ response: { data } })).resolves.toMatch(/nome completo/i)
  })
  it('junta mensagem em lista (erro de validação)', async () => {
    const data = new Blob([JSON.stringify({ message: ['cpf inválido', 'nome curto'] })])
    await expect(blobErrorMessage({ response: { data } })).resolves.toBe('cpf inválido, nome curto')
  })
  it('Blob que não é JSON não derruba o tratamento', async () => {
    await expect(blobErrorMessage({ response: { data: new Blob(['<html>502</html>']) } })).resolves.toBeNull()
  })
  it('erro sem response devolve null (mantém o erro original)', async () => {
    await expect(blobErrorMessage(new Error('network'))).resolves.toBeNull()
  })
})
