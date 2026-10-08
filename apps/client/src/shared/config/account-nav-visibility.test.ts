import { describe, expect, it } from 'vitest'
import { ACCOUNT_NAV } from './account-nav'
import { visibleAccountNav } from './account-nav-visibility'

const labels = (salesEnabled: boolean) => visibleAccountNav(ACCOUNT_NAV, { salesEnabled }).map((i) => i.label)

describe('visibleAccountNav', () => {
  it('onde o polo vende (a matriz inclusive): o menu inteiro, na ordem de sempre', () => {
    expect(labels(true)).toEqual(['Meus cursos', 'Meus dados', 'Financeiro', 'Certificados', 'Senha'])
  })
  it('polo sem venda online: sem Financeiro, o resto igual', () => {
    expect(labels(false)).toEqual(['Meus cursos', 'Meus dados', 'Certificados', 'Senha'])
  })
})
