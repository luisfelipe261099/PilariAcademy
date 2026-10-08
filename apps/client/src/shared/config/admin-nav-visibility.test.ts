import { describe, expect, it } from 'vitest'
import { ADMIN_NAV } from './admin-nav'
import { visibleAdminNav } from './admin-nav-visibility'

type Ctx = { isPlatformAdmin: boolean; isMatriz: boolean; salesEnabled: boolean }
/** Com a rede de polos ligada: o menu completo de quando houver polos e parceiros. */
const labels = (ctx: Ctx) => visibleAdminNav(ADMIN_NAV, ctx, true).map((i) => i.label)
const labelsSemRede = (ctx: Ctx) => visibleAdminNav(ADMIN_NAV, ctx, false).map((i) => i.label)

describe('visibleAdminNav com a rede desligada (Studio Pilari hoje)', () => {
  it('a admin da plataforma não vê polos, parceiros, aprovação nem logs da rede', () => {
    expect(labelsSemRede({ isPlatformAdmin: true, isMatriz: true, salesEnabled: true })).toEqual([
      'Visão geral', 'Cursos', 'Usuários', 'Alunos', 'Financeiro', 'Cobranças', 'Categorias', 'Cupons', 'Certificado', 'Logs',
    ])
  })
  it('é o padrão: sem o terceiro argumento, vale REDE_HABILITADA (false)', () => {
    expect(visibleAdminNav(ADMIN_NAV, { isPlatformAdmin: true, isMatriz: true, salesEnabled: true }).map((i) => i.label)).not.toContain('Polos')
  })
})

describe('visibleAdminNav', () => {
  it('admin da plataforma na matriz: o menu de hoje e o console no fim', () => {
    expect(labels({ isPlatformAdmin: true, isMatriz: true, salesEnabled: true })).toEqual([
      'Visão geral', 'Cursos', 'Parceiros', 'Usuários', 'Alunos', 'Financeiro', 'Cobranças', 'Categorias', 'Cupons', 'Certificado', 'Logs',
      'Polos', 'Aprovação de cursos', 'Logs da plataforma',
    ])
  })
  it('admin de polo sem venda: nada de cobrança e com Minha escola', () => {
    expect(labels({ isPlatformAdmin: false, isMatriz: false, salesEnabled: false })).toEqual([
      'Visão geral', 'Cursos', 'Parceiros', 'Usuários', 'Alunos', 'Categorias', 'Minha escola', 'Logs',
    ])
  })
  it('admin da plataforma num polo não vê o console', () => {
    expect(labels({ isPlatformAdmin: true, isMatriz: false, salesEnabled: false })).not.toContain('Polos')
  })
  it('admin da matriz que não é da plataforma não vê o console nem Minha escola', () => {
    const l = labels({ isPlatformAdmin: false, isMatriz: true, salesEnabled: true })
    expect(l).not.toContain('Polos')
    expect(l).not.toContain('Certificado')
    expect(l).not.toContain('Minha escola')
    expect(l).toContain('Cobranças')
  })
})
