/// <reference types="jest" />
import { BadRequestException, ConflictException } from '@nestjs/common'
import type { CreateTenantResult, PlatformTenantDetail } from '@pilari/types'
import { PlatformTenantsController } from './platform-tenants.controller'
import type { AddDomainDto, CreateTenantDto } from './dto/platform.dto'

const plataforma = { uid: 'u-plat', email: 'plataforma@studiopilari.test', isPlatformAdmin: true }

const detalhe = (over: Partial<PlatformTenantDetail> = {}): PlatformTenantDetail => ({
  id: 't-a', slug: 'polo-a', name: 'Polo A', status: 'active', isMatriz: false, siteUrl: 'https://polo-a.cursos.studiopilari.com.br',
  adminCount: 1, studentCount: 0, publishedCourseCount: 0, inReviewCount: 0, createdAt: null,
  branding: {
    logoUrl: null, logoLightUrl: null, faviconUrl: null, primaryColor: '#5c6e5a', accentColor: '#c67c89', whatsapp: null,
    phone: null, email: null, address: null, description: null, heroTitle: null, heroSubtitle: null,
  },
  domains: ['polo-a.cursos.studiopilari.com.br'], ...over,
})

function make() {
  const svc = {
    list: jest.fn(), detail: jest.fn(), create: jest.fn(), update: jest.fn(), addAdmin: jest.fn(),
    addDomain: jest.fn(async () => detalhe()), removeDomain: jest.fn(async () => detalhe()), assertExists: jest.fn(),
    mustGet: jest.fn(async () => ({ id: 't-a', slug: 'polo-a', name: 'Polo A' })),
  }
  const audit = { log: jest.fn() }
  const gcs = { signedUploadUrl: jest.fn() }
  const controller = new PlatformTenantsController(svc as never, gcs as never, audit as never)
  return { controller, svc, audit }
}

// B6: toda ação do console que afeta um polo é gravada com o tenantId DELE, para aparecer nos logs do polo e da rede, e o
// resumo leva o nome do polo, não o id.
describe('PlatformTenantsController: auditoria da plataforma', () => {
  it('o domínio cadastrado vai para o resumo normalizado (minúsculo, sem porta e sem ponto final), não como veio no corpo', async () => {
    const { controller, svc, audit } = make()
    await controller.addDomain(plataforma, 't-a', { host: 'Cursos.PoloA.com.br.:443' } as AddDomainDto)
    // O serviço recebe o valor cru e normaliza por conta própria; o log mostra o que ficou gravado.
    expect(svc.addDomain).toHaveBeenCalledWith('t-a', 'Cursos.PoloA.com.br.:443')
    expect(audit.log).toHaveBeenCalledTimes(1)
    expect(audit.log).toHaveBeenCalledWith({
      tenantId: 't-a', actorUid: 'u-plat', actorEmail: 'plataforma@studiopilari.test', action: 'tenant.domain-add',
      summary: 'Cadastrou o domínio cursos.poloa.com.br no polo Polo A', targetType: 'tenant', targetId: 't-a',
    })
  })

  it('o domínio removido também vai normalizado para o resumo', async () => {
    const { controller, svc, audit } = make()
    await controller.removeDomain(plataforma, 't-a', 'Cursos.PoloA.COM.br.')
    expect(svc.removeDomain).toHaveBeenCalledWith('t-a', 'Cursos.PoloA.COM.br.')
    expect(audit.log).toHaveBeenCalledWith({
      tenantId: 't-a', actorUid: 'u-plat', actorEmail: 'plataforma@studiopilari.test', action: 'tenant.domain-remove',
      summary: 'Removeu o domínio cursos.poloa.com.br do polo Polo A', targetType: 'tenant', targetId: 't-a',
    })
  })

  it('domínio já em minúsculo passa igual para o resumo', async () => {
    const { controller, audit } = make()
    await controller.addDomain(plataforma, 't-a', { host: 'cursos.poloa.com.br' } as AddDomainDto)
    expect(audit.log.mock.calls[0][0].summary).toBe('Cadastrou o domínio cursos.poloa.com.br no polo Polo A')
  })

  it('domínio recusado pelo serviço não deixa linha de auditoria', async () => {
    const { controller, svc, audit } = make()
    svc.addDomain.mockRejectedValue(new ConflictException('Este domínio já está em uso.'))
    await expect(controller.addDomain(plataforma, 't-a', { host: 'cursos.poloa.com.br' } as AddDomainDto)).rejects.toThrow(ConflictException)
    expect(audit.log).not.toHaveBeenCalled()
  })

  it('a criação do polo é auditada no polo criado, e só depois de dar certo', async () => {
    const { controller, svc, audit } = make()
    const resultado: CreateTenantResult = {
      tenant: detalhe(), firstAdmin: { uid: 'novo-1', email: 'diretora@polo.com', existingAccount: false, resetEmailSent: true },
    }
    svc.create.mockResolvedValue(resultado)
    const r = await controller.create(plataforma, { slug: 'polo-a', name: 'Polo A', firstAdminEmail: 'diretora@polo.com', firstAdminName: 'Diretora' } as CreateTenantDto)
    expect(r).toBe(resultado)
    // A marca é opcional no corpo, e o serviço sempre recebe um objeto.
    expect(svc.create).toHaveBeenCalledWith(expect.objectContaining({ slug: 'polo-a', branding: {} }))
    expect(audit.log).toHaveBeenCalledWith({
      tenantId: 't-a', actorUid: 'u-plat', actorEmail: 'plataforma@studiopilari.test', action: 'tenant.create',
      summary: 'Criou o polo Polo A (polo-a) com o admin diretora@polo.com', targetType: 'tenant', targetId: 't-a',
    })
  })

  it('criação que falha (e foi desfeita pelo serviço) não deixa linha de auditoria', async () => {
    const { controller, svc, audit } = make()
    svc.create.mockRejectedValue(new Error('Firebase fora do ar'))
    await expect(
      controller.create(plataforma, { slug: 'polo-a', name: 'Polo A', firstAdminEmail: 'a@b.com', firstAdminName: 'Ab' } as CreateTenantDto)
    ).rejects.toThrow('Firebase fora do ar')
    expect(audit.log).not.toHaveBeenCalled()
  })
})

describe('PlatformTenantsController: edição sem nada para alterar (B9)', () => {
  it('a recusa do serviço sobe e não deixa linha de auditoria', async () => {
    const { controller, svc, audit } = make()
    svc.update.mockRejectedValue(new BadRequestException('Nada para alterar.'))
    await expect(controller.update(plataforma, 't-a', {})).rejects.toThrow('Nada para alterar.')
    expect(audit.log).not.toHaveBeenCalled()
  })
})

describe('PlatformTenantsController: o polo afetado e o nome dele na auditoria (B6)', () => {
  it('vincular admin: no polo, com o nome do polo no resumo (não o id)', async () => {
    const { controller, svc, audit } = make()
    svc.addAdmin.mockResolvedValue({ uid: 'u9', email: 'diretora@polo.com', existingAccount: false, resetEmailSent: true })
    await controller.addAdmin(plataforma, 't-a', { email: 'diretora@polo.com', name: 'Diretora' })
    expect(svc.mustGet).toHaveBeenCalledWith('t-a')
    expect(audit.log).toHaveBeenCalledWith({
      tenantId: 't-a', actorUid: 'u-plat', actorEmail: 'plataforma@studiopilari.test', action: 'tenant.admin-add',
      summary: 'Vinculou diretora@polo.com como admin do polo Polo A', targetType: 'tenant', targetId: 't-a',
    })
  })

  it('editar (nome, marca, suspensão): no polo', async () => {
    const { controller, svc, audit } = make()
    svc.update.mockResolvedValue(detalhe({ status: 'suspended' }))
    await controller.update(plataforma, 't-a', { status: 'suspended' })
    expect(audit.log).toHaveBeenCalledWith({
      tenantId: 't-a', actorUid: 'u-plat', actorEmail: 'plataforma@studiopilari.test', action: 'tenant.update',
      summary: 'Alterou o polo Polo A: status → suspended', targetType: 'tenant', targetId: 't-a',
    })
  })

  it('vínculo recusado não deixa linha', async () => {
    const { controller, svc, audit } = make()
    svc.addAdmin.mockRejectedValue(new ConflictException('x'))
    await expect(controller.addAdmin(plataforma, 't-a', { email: 'a@b.com', name: 'Ab' })).rejects.toThrow(ConflictException)
    expect(audit.log).not.toHaveBeenCalled()
  })
})
