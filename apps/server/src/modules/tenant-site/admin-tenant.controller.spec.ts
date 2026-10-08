/// <reference types="jest" />
import { NotFoundException } from '@nestjs/common'
import { EMPTY_BRANDING } from '../tenancy/branding'
import type { TenantContext } from '../tenancy/tenant-context'
import { AdminTenantController } from './admin-tenant.controller'

// Polo que NÃO é a matriz: prova que o controller usa o polo da requisição e não uma constante.
const polo = (over: Partial<TenantContext> = {}): TenantContext => ({
  id: 't-x', slug: 'polo-x', name: 'Polo X', isMatriz: false, status: 'active',
  branding: { ...EMPTY_BRANDING }, updatedAt: new Date('2026-10-01T12:00:00Z'), ...over,
})

function make(doBanco: TenantContext | null) {
  const tenants = {
    getById: jest.fn(async () => doBanco),
    update: jest.fn(async () => doBanco),
    siteUrl: jest.fn(() => 'https://polo-x.cursos.studiopilari.com.br'),
  }
  const audit = { log: jest.fn() }
  const gcs = { signedUploadUrl: jest.fn(async (p: string) => `https://upload.fake/${p}`) }
  const controller = new AdminTenantController(tenants as never, gcs as never, audit as never)
  return { controller, tenants, audit, gcs }
}

describe('AdminTenantController.get: leitura fresca', () => {
  it('lê o polo no banco e não o do cache do endereço (que pode estar até 60 s velho em outra instância)', async () => {
    const velho = polo({ branding: { ...EMPTY_BRANDING, heroTitle: 'Título do cache' } })
    const novo = polo({ branding: { ...EMPTY_BRANDING, heroTitle: 'Título salvo por outra instância' }, updatedAt: new Date('2026-10-02T09:30:00Z') })
    const { controller, tenants } = make(novo)

    const r = await controller.get(velho)

    expect(tenants.getById).toHaveBeenCalledWith('t-x')
    expect(r.branding.heroTitle).toBe('Título salvo por outra instância')
    expect(r).toMatchObject({ slug: 'polo-x', name: 'Polo X', siteUrl: 'https://polo-x.cursos.studiopilari.com.br', isMatriz: false, salesEnabled: false })
  })

  it('a URL pública das imagens leva a versão do polo lido agora, não a do cache', async () => {
    const velho = polo({ branding: { ...EMPTY_BRANDING, logoUrl: 'polos/t-x/marca/logo-1-a.png' } })
    const novo = polo({ branding: { ...EMPTY_BRANDING, logoUrl: 'polos/t-x/marca/logo-2-b.png' }, updatedAt: new Date('2026-10-02T09:30:00Z') })
    const { controller } = make(novo)

    const r = await controller.get(velho)

    expect(r.branding.logoUrl).toBe('polos/t-x/marca/logo-2-b.png')
    expect(r.publicBranding.logoUrl).toBe(`/api/tenant/assets/logo?v=${novo.updatedAt.getTime()}`)
  })

  it('polo que sumiu do banco responde 404 TENANT_NOT_FOUND', async () => {
    const { controller } = make(null)
    const erro = await controller.get(polo()).catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(NotFoundException)
    expect((erro as NotFoundException).getResponse()).toMatchObject({ statusCode: 404, code: 'TENANT_NOT_FOUND', message: 'Polo não encontrado.' })
  })
})

describe('AdminTenantController: o polo é o da requisição', () => {
  it('update e upload usam o id do polo do endereço', async () => {
    const { controller, tenants, audit, gcs } = make(polo({ updatedAt: new Date('2026-10-02T09:30:00Z') }))

    await controller.update({ uid: 'adm', email: 'adm@x.com' }, polo(), { branding: { heroTitle: 'Olá' } })
    expect(tenants.update).toHaveBeenCalledWith('t-x', { branding: { heroTitle: 'Olá' } })
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-x', actorUid: 'adm', action: 'tenant.branding', summary: 'Alterou a marca do polo: heroTitle' }))

    const t = await controller.uploadUrl(polo(), { kind: 'logo', fileName: 'l.png', contentType: 'image/png' })
    expect(t.objectPath).toMatch(/^polos\/t-x\/marca\/logo-/)
    expect(gcs.signedUploadUrl).toHaveBeenCalledWith(t.objectPath, 'image/png')
  })
})
