import { describe, expect, it } from 'vitest'
import { tenantNameError, tenantNamePatch } from './tenant-form'

describe('tenantNameError', () => {
  it('aceita de 2 a 160 caracteres, contados depois de aparar', () => {
    for (const n of ['Ab', 'Polo Centro', ' Polo Centro ', 'a'.repeat(160)]) expect(tenantNameError(n)).toBeNull()
  })
  it('recusa vazio, só espaços, 1 caractere e mais de 160, com o texto do servidor', () => {
    for (const n of ['', '   ', 'A', ' A ', 'a'.repeat(161)]) expect(tenantNameError(n)).toBe('Informe o nome do polo (2 a 160 caracteres).')
  })
})

// O servidor responde 400 "Nada para alterar." a um PATCH sem campos: a tela só manda o nome quando há o que mandar.
describe('tenantNamePatch', () => {
  it('nome mudado vira o PATCH, já aparado', () => {
    expect(tenantNamePatch('Polo Centro', '  Polo Norte ')).toEqual({ name: 'Polo Norte' })
  })
  it('campo que ninguém tocou não manda nada', () => {
    expect(tenantNamePatch('Polo Centro', null)).toBeNull()
  })
  it('nome igual ao salvo, mesmo com espaços nas pontas, não manda nada', () => {
    expect(tenantNamePatch('Polo Centro', 'Polo Centro')).toBeNull()
    expect(tenantNamePatch('Polo Centro', '  Polo Centro  ')).toBeNull()
  })
  it('nome inválido não manda nada (a tela mostra o erro)', () => {
    expect(tenantNamePatch('Polo Centro', '')).toBeNull()
    expect(tenantNamePatch('Polo Centro', ' x ')).toBeNull()
    expect(tenantNamePatch('Polo Centro', 'a'.repeat(161))).toBeNull()
  })
})
