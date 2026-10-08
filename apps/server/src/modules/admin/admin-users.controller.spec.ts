/// <reference types="jest" />
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { Role } from '@pilari/types'
import type { TenantContext } from '../tenancy/tenant-context'
import { platformAccountForbidden } from '../tenancy/tenant-members.service'
import { AdminUsersController } from './admin-users.controller'

const TENANT = { id: 't-a', isMatriz: false, status: 'active' } as TenantContext
const MATRIZ = { id: 'm', isMatriz: true, status: 'active' } as TenantContext
/** Admin do polo do endereço: o guard já preencheu `roles` com os papéis EFETIVOS no polo. */
const ADMIN = { uid: 'me', email: 'adm@x.com', roles: [Role.admin] } as never
const PLATAFORMA = { uid: 'plat', email: 'plat@x.com', roles: [Role.admin], isPlatformAdmin: true } as never

function makeController(overrides: { authService?: any; identityService?: any; members?: any } = {}) {
  const authService = {
    listMembers: jest.fn(),
    getMemberDetail: jest.fn(),
    adminUpdateUser: jest.fn(),
    // Espelha o cadastro: devolve uma linha de `users` com o que veio.
    ensureUserRow: jest.fn(async (input: { uid: string; email: string; displayName: string }) => ({
      uid: input.uid, email: input.email, displayName: input.displayName, photoUrl: null, roles: ['student'], isPlatformAdmin: false,
    })),
    setTenantRoles: jest.fn(async () => ({
      uid: 'other', email: 'o@x.com', displayName: null, photoUrl: null, roles: [Role.teacher], isPlatformAdmin: false,
    })),
    ...overrides.authService,
  }
  const identityService = {
    findUidByEmail: jest.fn(async (): Promise<string | null> => null),
    createIdentity: jest.fn(async () => 'new-uid'),
    revokeTokens: jest.fn(),
    getFirebaseUser: jest.fn(async () => ({ uid: 'other', email: 'aluno@x.com' as string | undefined })),
    sendPasswordResetEmail: jest.fn(async () => undefined),
    updateUser: jest.fn(async () => undefined),
    ...overrides.identityService,
  }
  const admin = {
    listUserEnrollments: jest.fn(),
    grantEnrollment: jest.fn(),
    personLabel: jest.fn().mockResolvedValue('Aluno Teste'),
    courseTitle: jest.fn().mockResolvedValue('Curso Teste'),
    revokeEnrollment: jest.fn(),
  }
  const audit = { log: jest.fn() }
  const members = {
    isMember: jest.fn(async () => true),
    setRoles: jest.fn(async () => undefined),
    isPlatformAdmin: jest.fn(async () => false),
    isSharedOutside: jest.fn(async () => false),
    isLinkedOutside: jest.fn(async () => false),
    ...overrides.members,
  } as Record<string, jest.Mock>
  // A regra do B4 de verdade (TenantMembersService.assertNotPlatformAccount), sobre o isPlatformAdmin do dublê.
  members.assertNotPlatformAccount = jest.fn(async (actorIsPlatform: boolean, uid: string) => {
    if (!actorIsPlatform && (await members.isPlatformAdmin(uid))) throw platformAccountForbidden()
  })
  return {
    controller: new AdminUsersController(authService as never, identityService as never, admin as never, audit as never, members as never),
    authService,
    identityService,
    admin,
    audit,
    members,
  }
}

describe('AdminUsersController', () => {
  it('lista os membros do polo repassando page/pageSize/q e devolve { users, total }', async () => {
    const { controller, authService } = makeController({
      authService: { listMembers: jest.fn(async () => ({ users: [{ uid: 'u1' }], total: 1 })) },
    })
    const res = await controller.list(TENANT, { page: 2, pageSize: 20, q: 'ana' })
    expect(authService.listMembers).toHaveBeenCalledWith('t-a', { page: 2, pageSize: 20, q: 'ana' })
    expect(res).toEqual({ users: [{ uid: 'u1' }], total: 1 })
  })

  describe('create (cria ou vincula)', () => {
    const dto = { email: 'Novo@X.com', displayName: 'Novo Aluno', password: 'segredo123', roles: [Role.student] }

    it('e-mail sem conta na rede: cria a conta, o cadastro e o vínculo com os papéis NESTE polo', async () => {
      const { controller, identityService, authService, members, audit } = makeController()
      const res = await controller.create(ADMIN, TENANT, dto)
      expect(identityService.findUidByEmail).toHaveBeenCalledWith('novo@x.com')
      expect(identityService.createIdentity).toHaveBeenCalledWith('novo@x.com', 'Novo Aluno', 'segredo123')
      expect(authService.ensureUserRow).toHaveBeenCalledWith({ uid: 'new-uid', email: 'novo@x.com', displayName: 'Novo Aluno' })
      expect(members.setRoles).toHaveBeenCalledWith('t-a', 'new-uid', [Role.student])
      expect(res).toEqual({
        user: { uid: 'new-uid', email: 'novo@x.com', displayName: 'Novo Aluno', photoUrl: null, roles: [Role.student], isPlatformAdmin: false },
        existingAccount: false,
      })
      expect(audit.log).toHaveBeenCalledTimes(1)
      const entry = audit.log.mock.calls[0][0] as { summary: string }
      expect(entry).toEqual(expect.objectContaining({ tenantId: 't-a', actorUid: 'me', actorEmail: 'adm@x.com', action: 'user.create', targetType: 'user', targetId: 'new-uid' }))
      expect(entry.summary).toBe('Criou novo@x.com com papéis student')
    })

    it('e-mail sem conta: nem pergunta se já é do polo (não há vínculo possível)', async () => {
      const { controller, members } = makeController()
      await controller.create(ADMIN, TENANT, dto)
      expect(members.isMember).not.toHaveBeenCalled()
    })

    it('e-mail que já tem conta na rede: só vincula ao polo, sem criar conta nem usar a senha digitada', async () => {
      const { controller, identityService, authService, members, audit } = makeController({
        identityService: { findUidByEmail: jest.fn(async () => 'uid-da-rede') },
        members: { isMember: jest.fn(async () => false) },
      })
      const res = await controller.create(ADMIN, TENANT, { ...dto, displayName: 'Outro Nome', roles: [Role.teacher] })
      expect(identityService.createIdentity).not.toHaveBeenCalled()
      expect(authService.ensureUserRow).toHaveBeenCalledWith({ uid: 'uid-da-rede', email: 'novo@x.com', displayName: 'Outro Nome' })
      expect(members.isMember).toHaveBeenCalledWith('t-a', 'uid-da-rede')
      expect(members.setRoles).toHaveBeenCalledWith('t-a', 'uid-da-rede', [Role.teacher])
      expect(res.existingAccount).toBe(true)
      expect(res.user.roles).toEqual([Role.teacher]) // os papéis do polo, não os da coluna global
      expect((audit.log.mock.calls[0][0] as { summary: string }).summary).toBe('Vinculou novo@x.com com papéis teacher')
    })

    it('o isPlatformAdmin devolvido é o efetivo, lido depois do vínculo (admin dado na matriz já conta)', async () => {
      const { controller, members } = makeController({ members: { isPlatformAdmin: jest.fn(async () => true) } })
      const res = await controller.create(ADMIN, MATRIZ, { ...dto, roles: [Role.admin] })
      expect(res.user.isPlatformAdmin).toBe(true)
      expect(members.setRoles.mock.invocationCallOrder[0]).toBeLessThan(members.isPlatformAdmin.mock.invocationCallOrder[0])
    })

    it('conta da equipe do Studio Pilari não é vinculada pelo polo (B4): 403 PLATFORM_ACCOUNT, sem vínculo, cadastro nem log', async () => {
      const { controller, identityService, authService, members, audit } = makeController({
        identityService: { findUidByEmail: jest.fn(async () => 'u-plat') },
        members: { isPlatformAdmin: jest.fn(async () => true), isMember: jest.fn(async () => false) },
      })
      const pedido = controller.create(ADMIN, TENANT, dto)
      await expect(pedido).rejects.toBeInstanceOf(ForbiddenException)
      await expect(pedido).rejects.toMatchObject({
        response: { statusCode: 403, code: 'PLATFORM_ACCOUNT', message: 'Esta conta é da equipe do Studio Pilari e não pode ser alterada pelo polo.' },
      })
      expect(members.isPlatformAdmin).toHaveBeenCalledWith('u-plat')
      expect(identityService.createIdentity).not.toHaveBeenCalled()
      expect(authService.ensureUserRow).not.toHaveBeenCalled()
      expect(members.setRoles).not.toHaveBeenCalled()
      expect(audit.log).not.toHaveBeenCalled()
    })

    it('a plataforma vincula a conta da plataforma', async () => {
      const { controller, members } = makeController({
        identityService: { findUidByEmail: jest.fn(async () => 'u-plat') },
        members: { isPlatformAdmin: jest.fn(async () => true), isMember: jest.fn(async () => false) },
      })
      const res = await controller.create(PLATAFORMA, TENANT, dto)
      expect(members.setRoles).toHaveBeenCalledWith('t-a', 'u-plat', [Role.student])
      expect(res.user.isPlatformAdmin).toBe(true)
    })

    it('quem já é do polo → 409, sem criar conta, sem tocar no cadastro, sem mudar papéis e sem auditar', async () => {
      const { controller, identityService, authService, members, audit } = makeController({
        identityService: { findUidByEmail: jest.fn(async () => 'uid-da-rede') },
        members: { isMember: jest.fn(async () => true) },
      })
      const pedido = controller.create(ADMIN, TENANT, dto)
      await expect(pedido).rejects.toBeInstanceOf(ConflictException)
      await expect(pedido).rejects.toThrow('Esta pessoa já faz parte do polo. Altere os papéis na lista de usuários.')
      expect(identityService.createIdentity).not.toHaveBeenCalled()
      expect(authService.ensureUserRow).not.toHaveBeenCalled()
      expect(members.setRoles).not.toHaveBeenCalled()
      expect(audit.log).not.toHaveBeenCalled()
    })
  })

  it('GET :uid devolve { user } do membro do polo, com o ator (o CPF de pessoa compartilhada sai mascarado para o polo)', async () => {
    const detail = { uid: 'u1' }
    const { controller, authService } = makeController({ authService: { getMemberDetail: jest.fn(async () => detail) } })
    const res = await controller.detail(ADMIN, TENANT, 'u1')
    expect(authService.getMemberDetail).toHaveBeenCalledWith({ uid: 'me', tenantId: 't-a', isMatriz: false, isAdmin: true, isPlatformAdmin: false }, 'u1')
    expect(res).toEqual({ user: detail })
    await controller.detail(PLATAFORMA, TENANT, 'u1')
    expect(authService.getMemberDetail).toHaveBeenLastCalledWith(expect.objectContaining({ isPlatformAdmin: true }), 'u1')
  })

  describe('setRoles', () => {
    it('impede o admin de remover o próprio papel admin (400)', async () => {
      const { controller, authService } = makeController()
      await expect(
        controller.setRoles({ uid: 'me', roles: [Role.admin] } as never, TENANT, 'me', { roles: [Role.student] })
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(authService.setTenantRoles).not.toHaveBeenCalled()
    })

    it('o admin pode mudar os próprios outros papéis, desde que continue admin', async () => {
      const { controller, authService } = makeController()
      await controller.setRoles(ADMIN, TENANT, 'me', { roles: [Role.admin, Role.teacher] })
      expect(authService.setTenantRoles).toHaveBeenCalledWith(expect.objectContaining({ uid: 'me' }), 'me', [Role.admin, Role.teacher])
    })

    it('altera papéis de outro usuário NO POLO, sem mexer em claims nem revogar o token dele', async () => {
      const { controller, authService, identityService, audit } = makeController()
      const res = await controller.setRoles({ uid: 'me', email: 'adm@x.com', roles: [Role.admin] } as never, TENANT, 'other', { roles: [Role.teacher] })
      expect(res.user.roles).toEqual([Role.teacher])
      expect(authService.setTenantRoles).toHaveBeenCalledWith(
        { uid: 'me', tenantId: 't-a', isMatriz: false, isAdmin: true, isPlatformAdmin: false },
        'other',
        [Role.teacher]
      )
      // Os papéis moram em tenant_members e o banco é lido a cada requisição: vale na próxima chamada.
      expect(identityService.revokeTokens).not.toHaveBeenCalled()
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-a', action: 'user.roles', targetId: 'other' }))
    })

    it('o ator leva a marca da plataforma e da matriz, que decidem a regra do último admin', async () => {
      const { controller, authService } = makeController()
      await controller.setRoles(PLATAFORMA, MATRIZ, 'other', { roles: [Role.teacher] })
      expect(authService.setTenantRoles).toHaveBeenCalledWith(
        { uid: 'plat', tenantId: 'm', isMatriz: true, isAdmin: true, isPlatformAdmin: true },
        'other',
        [Role.teacher]
      )
    })
  })

  describe('sendPasswordReset (A07: reset sem senha conhecida)', () => {
    const current = { uid: 'adm1', email: 'admin@x.com' } as never

    it('envia o link ao e-mail do titular, revoga as sessões e audita', async () => {
      const { controller, identityService, audit } = makeController()
      const res = await controller.sendPasswordReset(current, TENANT, 'other')
      expect(res).toEqual({ ok: true })
      expect(identityService.sendPasswordResetEmail).toHaveBeenCalledWith('aluno@x.com')
      expect(identityService.revokeTokens).toHaveBeenCalledWith('other')
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-a', action: 'user.password-reset', targetId: 'other' }))
    })

    it('NUNCA define senha via updateUser (senha não pode ser conhecida por terceiro)', async () => {
      const { controller, identityService } = makeController()
      await controller.sendPasswordReset(current, TENANT, 'other')
      expect(identityService.updateUser).not.toHaveBeenCalled()
    })

    it('usuário sem e-mail → 400, sem envio e sem revogação', async () => {
      const { controller, identityService } = makeController()
      identityService.getFirebaseUser.mockResolvedValueOnce({ uid: 'other', email: undefined })
      await expect(controller.sendPasswordReset(current, TENANT, 'other')).rejects.toBeInstanceOf(BadRequestException)
      expect(identityService.sendPasswordResetEmail).not.toHaveBeenCalled()
      expect(identityService.revokeTokens).not.toHaveBeenCalled()
    })

    it('conta da equipe do Studio Pilari: o polo não redefine a senha (403 PLATFORM_ACCOUNT), nem e-mail nem revogação', async () => {
      const { controller, identityService, audit } = makeController({ members: { isPlatformAdmin: jest.fn(async () => true) } })
      await expect(controller.sendPasswordReset(current, TENANT, 'u-adm-m')).rejects.toMatchObject({ response: { code: 'PLATFORM_ACCOUNT' } })
      expect(identityService.sendPasswordResetEmail).not.toHaveBeenCalled()
      expect(identityService.revokeTokens).not.toHaveBeenCalled()
      expect(audit.log).not.toHaveBeenCalled()
    })

    it('pessoa ligada a outro polo (qualquer vínculo, até o passivo do login): o polo não redefine a senha (vale e derruba a sessão na rede inteira): 403 com mensagem própria', async () => {
      const { controller, identityService, members, audit } = makeController({ members: { isLinkedOutside: jest.fn(async () => true) } })
      const pedido = controller.sendPasswordReset(current, TENANT, 'other')
      await expect(pedido).rejects.toBeInstanceOf(ForbiddenException)
      await expect(pedido).rejects.toMatchObject({
        response: {
          statusCode: 403,
          code: 'SHARED_USER_PLATFORM_ONLY',
          message: 'Esta pessoa também está ligada a outro polo da rede, e a senha vale em todos eles: quem redefine a senha é o Studio Pilari.',
        },
      })
      expect(members.isLinkedOutside).toHaveBeenCalledWith('t-a', 'other')
      expect(identityService.getFirebaseUser).not.toHaveBeenCalled()
      expect(identityService.sendPasswordResetEmail).not.toHaveBeenCalled()
      expect(identityService.revokeTokens).not.toHaveBeenCalled()
      expect(audit.log).not.toHaveBeenCalled()
    })

    it('a plataforma redefine a senha de quem quer que seja, compartilhada ou da plataforma, sem perguntar', async () => {
      const { controller, identityService, members } = makeController({
        members: { isLinkedOutside: jest.fn(async () => true), isPlatformAdmin: jest.fn(async () => true) },
      })
      await controller.sendPasswordReset(PLATAFORMA, TENANT, 'other')
      expect(identityService.sendPasswordResetEmail).toHaveBeenCalledWith('aluno@x.com')
      expect(members.isLinkedOutside).not.toHaveBeenCalled()
      expect(members.isPlatformAdmin).not.toHaveBeenCalled()
    })

    it('quem não é do polo → 404, antes de qualquer chamada ao Firebase: nem e-mail, nem revogação, nem log', async () => {
      const { controller, identityService, audit, members } = makeController({ members: { isMember: jest.fn(async () => false) } })
      const pedido = controller.sendPasswordReset(current, TENANT, 'u-de-fora')
      await expect(pedido).rejects.toBeInstanceOf(NotFoundException)
      await expect(pedido).rejects.toThrow('Usuário não encontrado neste polo.')
      expect(members.isMember).toHaveBeenCalledWith('t-a', 'u-de-fora')
      expect(identityService.getFirebaseUser).not.toHaveBeenCalled()
      expect(identityService.sendPasswordResetEmail).not.toHaveBeenCalled()
      expect(identityService.revokeTokens).not.toHaveBeenCalled()
      expect(audit.log).not.toHaveBeenCalled()
    })
  })
})

describe('AdminUsersController — perfil do aluno', () => {
  const detail = {
    uid: 'u1', email: 'ana@x.com', displayName: 'Ana Souza', photoUrl: null, roles: [Role.student],
    disabled: false, cpf: '52998224725', createdAt: '2026-01-02T00:00:00.000Z',
  }

  it('PATCH :uid grava nome e CPF e audita SEM expor o CPF inteiro no resumo', async () => {
    const { controller, authService, audit } = makeController({ authService: { adminUpdateUser: jest.fn(async () => detail) } })
    const res = await controller.update({ uid: 'me', email: 'adm@x.com', roles: [Role.admin] } as never, TENANT, 'u1', { displayName: 'Ana Souza', cpf: '529.982.247-25' })
    expect(authService.adminUpdateUser).toHaveBeenCalledWith(
      { uid: 'me', tenantId: 't-a', isMatriz: false, isAdmin: true, isPlatformAdmin: false },
      'u1',
      { displayName: 'Ana Souza', cpf: '529.982.247-25' }
    )
    expect(res).toEqual({ user: detail })
    expect(audit.log).toHaveBeenCalledTimes(1)
    const entry = audit.log.mock.calls[0][0] as { tenantId: string | null; actorUid: string; action: string; targetType: string; targetId: string; summary: string }
    expect(entry).toEqual(expect.objectContaining({ tenantId: 't-a', actorUid: 'me', action: 'user.profile-admin', targetType: 'user', targetId: 'u1' }))
    expect(entry.summary).toContain('nome')
    expect(entry.summary).toContain('CPF')
    expect(entry.summary).not.toContain('52998224725')
    expect(entry.summary).not.toContain('529.982.247-25')
  })

  it('PATCH :uid só com nome não menciona CPF no resumo', async () => {
    const { controller, audit } = makeController({ authService: { adminUpdateUser: jest.fn(async () => detail) } })
    await controller.update({ uid: 'me', email: 'adm@x.com' } as never, TENANT, 'u1', { displayName: 'Ana Souza' })
    const entry = audit.log.mock.calls[0][0] as { summary: string }
    expect(entry.summary).not.toContain('CPF')
  })

  it('PATCH :uid da plataforma chega ao serviço marcado como plataforma (é ela quem corrige aluno compartilhado)', async () => {
    const { controller, authService } = makeController({ authService: { adminUpdateUser: jest.fn(async () => detail) } })
    await controller.update(PLATAFORMA, TENANT, 'u1', { displayName: 'Ana Souza' })
    expect(authService.adminUpdateUser).toHaveBeenCalledWith(expect.objectContaining({ uid: 'plat', isPlatformAdmin: true }), 'u1', { displayName: 'Ana Souza' })
  })

  it('PATCH :uid recusado pelo serviço não deixa rastro no log de auditoria', async () => {
    const recusa = new NotFoundException('Usuário não encontrado neste polo.')
    const { controller, audit } = makeController({ authService: { adminUpdateUser: jest.fn(async () => { throw recusa }) } })
    await expect(controller.update(ADMIN, TENANT, 'u-de-fora', { displayName: 'Ana Souza' })).rejects.toBe(recusa)
    expect(audit.log).not.toHaveBeenCalled()
  })
})

describe('AdminUsersController — cortesia por polo', () => {
  it('lista as matrículas do usuário passando o polo primeiro', async () => {
    const { controller, admin } = makeController()
    admin.listUserEnrollments.mockResolvedValue([{ courseId: 'c1' }])
    const res = await controller.enrollments(TENANT, 'u1')
    expect(admin.listUserEnrollments).toHaveBeenCalledWith('t-a', 'u1')
    expect(res).toEqual({ enrollments: [{ courseId: 'c1' }] })
  })

  it('concede o curso passando o polo primeiro e audita no polo', async () => {
    const { controller, admin, audit } = makeController()
    admin.grantEnrollment.mockResolvedValue({ courseId: 'c1', courseTitle: 'Excel', courseSlug: 'excel', status: 'active', source: 'free' })
    const res = await controller.grant(ADMIN, TENANT, 'u1', { courseId: 'c1' })
    expect(admin.grantEnrollment).toHaveBeenCalledWith('t-a', 'u1', 'c1')
    expect(res.enrollment.courseTitle).toBe('Excel')
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-a', action: 'enrollment.grant', targetId: 'u1' }))
  })

  it('retira o acesso passando o polo primeiro e audita no polo', async () => {
    const { controller, admin, audit } = makeController()
    admin.revokeEnrollment.mockResolvedValue({ ok: true })
    const res = await controller.revoke(ADMIN, TENANT, 'u1', 'c1')
    expect(admin.revokeEnrollment).toHaveBeenCalledWith('t-a', 'u1', 'c1')
    expect(res).toEqual({ ok: true })
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-a', action: 'enrollment.revoke', targetId: 'u1' }))
  })

  it('conta da equipe do Studio Pilari: o polo não retira o acesso dela (403 PLATFORM_ACCOUNT), como na concessão; a plataforma retira', async () => {
    const polo = makeController({ members: { isPlatformAdmin: jest.fn(async () => true) } })
    await expect(polo.controller.revoke(ADMIN, TENANT, 'u-adm-m', 'c1')).rejects.toMatchObject({ response: { code: 'PLATFORM_ACCOUNT' } })
    expect(polo.admin.revokeEnrollment).not.toHaveBeenCalled()
    expect(polo.audit.log).not.toHaveBeenCalled()

    const plataforma = makeController({ members: { isPlatformAdmin: jest.fn(async () => true) } })
    plataforma.admin.revokeEnrollment.mockResolvedValue({ ok: true })
    await expect(plataforma.controller.revoke(PLATAFORMA, TENANT, 'u-adm-m', 'c1')).resolves.toEqual({ ok: true })
  })

  it('polo suspenso não concede cortesia (B12): 403 TENANT_SUSPENDED, também para a plataforma, sem matrícula nem log', async () => {
    const SUSPENSO = { id: 't-a', isMatriz: false, status: 'suspended' } as TenantContext
    for (const quem of [ADMIN, PLATAFORMA]) {
      const { controller, admin, audit, members } = makeController()
      const pedido = controller.grant(quem, SUSPENSO, 'u1', { courseId: 'c1' })
      await expect(pedido).rejects.toBeInstanceOf(ForbiddenException)
      await expect(pedido).rejects.toMatchObject({
        response: { statusCode: 403, code: 'TENANT_SUSPENDED', message: 'O polo está suspenso: novas matrículas ficam bloqueadas até a regularização.' },
      })
      expect(admin.grantEnrollment).not.toHaveBeenCalled()
      expect(members.isPlatformAdmin).not.toHaveBeenCalled()
      expect(audit.log).not.toHaveBeenCalled()
    }
  })

  it('conta da equipe do Studio Pilari não ganha cortesia pelo polo (B4): 403 PLATFORM_ACCOUNT, sem matrícula nem vínculo', async () => {
    const { controller, admin, audit } = makeController({ members: { isPlatformAdmin: jest.fn(async () => true) } })
    await expect(controller.grant(ADMIN, TENANT, 'u-plat', { courseId: 'c1' })).rejects.toMatchObject({ response: { code: 'PLATFORM_ACCOUNT' } })
    expect(admin.grantEnrollment).not.toHaveBeenCalled()
    expect(audit.log).not.toHaveBeenCalled()
  })

  it('curso de outro polo (404 do serviço) não deixa rastro no log', async () => {
    const { controller, admin, audit } = makeController()
    admin.grantEnrollment.mockRejectedValue(new NotFoundException('Curso não encontrado.'))
    await expect(controller.grant(ADMIN, TENANT, 'u1', { courseId: 'c-do-b' })).rejects.toBeInstanceOf(NotFoundException)
    expect(audit.log).not.toHaveBeenCalled()
  })
})
