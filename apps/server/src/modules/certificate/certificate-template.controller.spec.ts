/// <reference types="jest" />
import { BadRequestException, type ExecutionContext, ForbiddenException } from '@nestjs/common'
import { PATH_METADATA } from '@nestjs/common/constants'
import { Reflector } from '@nestjs/core'
import { Role } from '@pilari/types'
import { RolesGuard } from '../../common/guards/roles.guard'
import { CertificateTemplateController } from './certificate-template.controller'

function make() {
  const templates = {
    getEditableHtml: jest.fn(async () => '<factory>'),
    list: jest.fn(async () => [{ id: 't1', name: 'Padrão', isDefault: true, updatedAt: null, courseCount: 2 }]),
    getOne: jest.fn(async () => ({ id: 't1', name: 'Padrão', html: '<html>', isDefault: true })),
    create: jest.fn(async () => ({ id: 'novo' })),
    update: jest.fn(async () => ({ name: 'Padrão' })),
    setDefault: jest.fn(async () => ({ name: 'Com assinatura' })),
    remove: jest.fn(async () => ({ cursosLiberados: 3, name: 'Antigo' })),
    coursesOf: jest.fn(async () => [{ id: 'c1', title: 'Grafologia' }]),
    assign: jest.fn(async () => ({
      atualizados: 2,
      cursos: [{ id: 'c1', title: 'Grafologia', tenantId: 't-a' }, { id: 'c2', title: 'Excel', tenantId: 't-b' }],
      modelo: 'Com assinatura' as string | null,
    })),
  }
  const certificates = {
    invalidatePdfCache: jest.fn(async () => undefined),
    coordinatorOf: jest.fn(async () => ({
      name: 'Jane Veck',
      role: 'Coordenadora do Curso',
      signatureDataUri: 'data:image/png;base64,RUBRICA',
    })),
  }
  const pdf = { generate: jest.fn(async () => Buffer.from('%PDF-mock-content-1234567890')) }
  const audit = { log: jest.fn() }
  return {
    templates,
    certificates,
    pdf,
    audit,
    controller: new CertificateTemplateController(templates as never, certificates as never, pdf as never, audit as never),
  }
}

const PLATAFORMA = { uid: 'plat1', email: 'plat@studiopilari.com.br' } as never

function mockRes() {
  const res = { set: jest.fn(), send: jest.fn() } as { set: jest.Mock; send: jest.Mock }
  res.set.mockReturnValue(res)
  res.send.mockReturnValue(res)
  return res
}

describe('CertificateTemplateController', () => {
  it('GET lista os templates com a contagem de cursos', async () => {
    const { controller } = make()
    const r = await controller.list()
    expect(r.templates[0]).toEqual(expect.objectContaining({ name: 'Padrão', courseCount: 2 }))
  })

  it('GET /novo devolve o HTML de partida para um template novo', async () => {
    const { controller } = make()
    expect(await controller.novo()).toEqual({ html: '<factory>' })
  })

  it('POST cria com o uid do admin', async () => {
    const { templates, controller } = make()
    await controller.create({ uid: 'admin1' } as never, { name: 'Sem assinatura', html: '<novo>' })
    expect(templates.create).toHaveBeenCalledWith('Sem assinatura', '<novo>', 'admin1')
  })

  it('PUT atualiza com o uid do admin', async () => {
    const { templates, controller } = make()
    await controller.update({ uid: 'admin1' } as never, 't1', { html: '<editado>' })
    expect(templates.update).toHaveBeenCalledWith('t1', { name: undefined, html: '<editado>' }, 'admin1')
  })

  it('DELETE devolve quantos cursos voltaram ao padrão', async () => {
    const { controller } = make()
    expect(await controller.remove(PLATAFORMA, 't2')).toEqual({ cursosLiberados: 3 })
  })

  it('vincular passa o templateId e os cursos, e devolve só a contagem', async () => {
    const { templates, controller } = make()
    expect(await controller.assign(PLATAFORMA, { templateId: 't1', courseIds: ['c1', 'c2'] })).toEqual({ atualizados: 2 })
    expect(templates.assign).toHaveBeenCalledWith('t1', ['c1', 'c2'])
  })

  it('vincular SEM templateId devolve os cursos ao padrão (null, não undefined)', async () => {
    // `undefined` chegaria ao Drizzle como "não mexa nesta coluna" e o desvínculo seria
    // silenciosamente ignorado — a tela mostraria sucesso sem ter feito nada.
    const { templates, controller } = make()
    await controller.assign(PLATAFORMA, { courseIds: ['c1'] })
    expect(templates.assign).toHaveBeenCalledWith(null, ['c1'])
  })

  describe('rastro no log', () => {
    const naRede = (action: string, targetId: string, summary: string) => ({
      tenantId: null, actorUid: 'plat1', actorEmail: 'plat@studiopilari.com.br', action, summary, targetType: 'certificate-template', targetId,
    })

    it('criar, editar, marcar padrão e apagar vão para o log da rede (sem polo), com o nome do modelo', async () => {
      const { audit, controller } = make()
      await controller.create(PLATAFORMA, { name: 'Sem assinatura', html: '<novo>' })
      await controller.update(PLATAFORMA, 't1', { name: 'Padrão', html: '<editado>' })
      await controller.update(PLATAFORMA, 't1', { html: '<editado>' })
      await controller.setDefault(PLATAFORMA, 't3')
      await controller.remove(PLATAFORMA, 't2')
      expect(audit.log.mock.calls.map((c) => c[0])).toEqual([
        naRede('certificate-template.create', 'novo', 'Criou o modelo de certificado "Sem assinatura"'),
        naRede('certificate-template.update', 't1', 'Editou o modelo de certificado "Padrão": o nome e o HTML'),
        naRede('certificate-template.update', 't1', 'Editou o modelo de certificado "Padrão": o HTML'),
        naRede('certificate-template.default', 't3', 'Marcou o modelo de certificado "Com assinatura" como padrão'),
        naRede('certificate-template.delete', 't2', 'Apagou o modelo de certificado "Antigo" (3 cursos voltaram ao padrão)'),
      ])
    })

    it('vincular grava uma entrada no polo de cada curso, com o título do curso e o nome do modelo', async () => {
      const { audit, controller } = make()
      await controller.assign(PLATAFORMA, { templateId: 't1', courseIds: ['c1', 'c2'] })
      expect(audit.log.mock.calls.map((c) => c[0])).toEqual([
        { tenantId: 't-a', actorUid: 'plat1', actorEmail: 'plat@studiopilari.com.br', action: 'certificate-template.assign', targetType: 'course', targetId: 'c1', summary: 'Curso "Grafologia": modelo de certificado "Com assinatura"' },
        { tenantId: 't-b', actorUid: 'plat1', actorEmail: 'plat@studiopilari.com.br', action: 'certificate-template.assign', targetType: 'course', targetId: 'c2', summary: 'Curso "Excel": modelo de certificado "Com assinatura"' },
      ])
    })

    it('desvincular registra a volta ao padrão; curso inexistente não gera entrada', async () => {
      const { audit, templates, controller } = make()
      templates.assign.mockResolvedValueOnce({ atualizados: 1, cursos: [{ id: 'c1', title: 'Grafologia', tenantId: 't-a' }], modelo: null })
      await controller.assign(PLATAFORMA, { templateId: null, courseIds: ['c1', 'nao-existe'] })
      expect(audit.log).toHaveBeenCalledTimes(1)
      expect(audit.log.mock.calls[0][0]).toMatchObject({ tenantId: 't-a', summary: 'Curso "Grafologia": voltou ao modelo de certificado padrão' })
    })

    it('falha (404, padrão que não se apaga) não grava nada', async () => {
      const { audit, templates, controller } = make()
      templates.remove.mockRejectedValueOnce(new BadRequestException('Não dá para apagar o template padrão.'))
      await expect(controller.remove(PLATAFORMA, 't1')).rejects.toBeInstanceOf(BadRequestException)
      expect(audit.log).not.toHaveBeenCalled()
    })
  })

  it('preview gera um PDF (com o HTML enviado) e envia inline', async () => {
    const { pdf, controller } = make()
    const res = mockRes()
    await controller.preview({ html: '<x>' }, undefined, res as never)
    expect(pdf.generate).toHaveBeenCalledWith(expect.any(Object), '<x>')
    expect(res.set).toHaveBeenCalledWith(expect.objectContaining({ 'Content-Type': 'application/pdf' }))
    const sent = res.send.mock.calls[0][0] as Buffer
    expect(sent.subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('preview COM courseId usa o coordenador real daquele curso', async () => {
    // Com dados fictícios o bloco da 2ª assinatura nunca apareceria, e o admin não teria
    // como conferir o layout que está editando.
    const { pdf, certificates, controller } = make()
    await controller.preview({ html: '<x>' }, 'c1', mockRes() as never)
    expect(certificates.coordinatorOf).toHaveBeenCalledWith('c1')
    expect(pdf.generate).toHaveBeenCalledWith(
      expect.objectContaining({ coordinatorName: 'Jane Veck', coordinatorRole: 'Coordenadora do Curso' }),
      '<x>'
    )
  })

  it('preview COM courseId leva a RUBRICA adiante, não só o nome', async () => {
    // Bug real: `sampleData` recebia só nome e cargo, então o preview mostrava o bloco da
    // 2ª assinatura SEM a imagem — e o admin não tinha como conferir a rubrica que acabara
    // de subir. Não basta chamar `coordinatorOf`: o que ele devolve tem que CHEGAR ao PDF.
    const { pdf, controller } = make()
    await controller.preview({ html: '<x>' }, 'c1', mockRes() as never)
    expect(pdf.generate).toHaveBeenCalledWith(
      expect.objectContaining({ coordinatorSignatureDataUri: 'data:image/png;base64,RUBRICA' }),
      '<x>'
    )
  })

  it('preview SEM courseId não inventa coordenador', async () => {
    const { pdf, certificates, controller } = make()
    await controller.preview({ html: '<x>' }, undefined, mockRes() as never)
    expect(certificates.coordinatorOf).not.toHaveBeenCalled()
    expect(pdf.generate).toHaveBeenCalledWith(
      expect.objectContaining({ coordinatorName: undefined }),
      '<x>'
    )
  })

  it('preview com falha do pdfSynth → BadRequestException', async () => {
    const { pdf, controller } = make()
    pdf.generate.mockRejectedValueOnce(new Error('boom'))
    await expect(controller.preview({ html: '<x>' }, undefined, mockRes() as never)).rejects.toBeInstanceOf(
      BadRequestException
    )
  })
})

describe('CertificateTemplateController: acesso só da plataforma', () => {
  // O modelo é GLOBAL (vale para todos os polos) e `vincular` troca o modelo de cursos de qualquer polo,
  // sem filtro de polo: admin de polo não pode tocar em nada aqui. Os testes acima chamam o controller direto
  // e contornam o guard; este usa o RolesGuard REAL sobre as decorators REAIS de cada rota.
  type Handler = (...args: never[]) => unknown
  const proto = CertificateTemplateController.prototype as unknown as Record<string, Handler>
  const rotas = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor' && Reflect.hasMetadata(PATH_METADATA, proto[n]))
  const guard = new RolesGuard(new Reflector())
  const contexto = (handler: Handler, user: object): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => CertificateTemplateController,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext

  it('a varredura enxerga as rotas do controller (não pode passar vazia)', () => {
    expect(rotas).toEqual(expect.arrayContaining(['list', 'novo', 'getOne', 'coursesOf', 'create', 'update', 'setDefault', 'remove', 'assign', 'preview']))
  })

  it.each(rotas)('%s: o admin do polo é negado e a plataforma passa', (nome) => {
    const handler = proto[nome]
    expect(() => guard.canActivate(contexto(handler, { uid: 'adm-polo', roles: [Role.admin], isPlatformAdmin: false }))).toThrow(ForbiddenException)
    expect(guard.canActivate(contexto(handler, { uid: 'plat', roles: [Role.admin], isPlatformAdmin: true }))).toBe(true)
  })

  it.each(rotas)('%s: nem professor nem aluno passam', (nome) => {
    const handler = proto[nome]
    for (const roles of [[Role.teacher], [Role.student]]) {
      expect(() => guard.canActivate(contexto(handler, { uid: 'u', roles, isPlatformAdmin: false }))).toThrow(ForbiddenException)
    }
  })
})
