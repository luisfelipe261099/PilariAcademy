/// <reference types="jest" />
import { UnauthorizedException } from '@nestjs/common'
import type { ExecutionContext } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import type { Reflector } from '@nestjs/core'
import { Role } from '@pilari/types'
import { FirebaseAuthGuard } from './firebase-auth.guard'
import type { IdentityService } from '../../modules/auth/identity.service'
import type { AuthService } from '../../modules/auth/auth.service'
import type { TenantMembersService } from '../../modules/tenancy/tenant-members.service'

type DbUser = { uid: string; roles?: Role[]; disabled?: boolean; isPlatformAdmin?: boolean } | null

function makeContext(headers: Record<string, string | undefined>, tenantId: string | undefined = 't-a') {
  const request: {
    headers: Record<string, string | undefined>
    user?: { uid: string; roles?: Role[]; isPlatformAdmin?: boolean }
    tenant?: { id: string }
  } = { headers, tenant: tenantId ? { id: tenantId } : undefined }
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext
  return { ctx, request }
}

function makeGuard(opts: {
  authRequired?: string
  verify?: jest.Mock
  dbUser?: DbUser
  isPublic?: boolean
  memberRoles?: Role[] | null
  matrizRoles?: Role[] | null
  members?: { rolesHereAndInMatriz: jest.Mock }
}) {
  const config = { get: jest.fn(() => opts.authRequired ?? '1') } as unknown as ConfigService
  const reflector = { getAllAndOverride: jest.fn(() => opts.isPublic ?? undefined) } as unknown as Reflector
  const identity = { verifyIdToken: opts.verify ?? jest.fn() } as unknown as IdentityService
  const auth = { getUserByUid: jest.fn().mockResolvedValue(opts.dbUser ?? null) } as unknown as AuthService
  const members = opts.members ?? {
    rolesHereAndInMatriz: jest.fn().mockResolvedValue({ roles: opts.memberRoles ?? null, matrizRoles: opts.matrizRoles ?? null }),
  }
  return new FirebaseAuthGuard(config, reflector, identity, auth, members as unknown as TenantMembersService)
}

describe('FirebaseAuthGuard', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('recusa subir quando AUTH_REQUIRED != 1', async () => {
    const guard = makeGuard({ authRequired: '0' })
    const { ctx } = makeContext({ authorization: 'Bearer x' })
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException)
  })

  it('retorna 401 quando não há token', async () => {
    const guard = makeGuard({})
    const { ctx } = makeContext({})
    await expect(guard.canActivate(ctx)).rejects.toThrow('Token não fornecido')
  })

  it('libera rota @Public() sem exigir token', async () => {
    const guard = makeGuard({ isPublic: true })
    const { ctx } = makeContext({})
    await expect(guard.canActivate(ctx)).resolves.toBe(true)
  })

  it('usa os papéis do vínculo do polo, não os papéis globais nem o claim', async () => {
    const verify = jest.fn().mockResolvedValue({ uid: 'u1', email: 'a@x.com', roles: [Role.admin] })
    const guard = makeGuard({ verify, dbUser: { uid: 'u1', roles: [Role.admin], disabled: false }, memberRoles: [Role.teacher] })
    const { ctx, request } = makeContext({ authorization: 'Bearer tok' })
    await expect(guard.canActivate(ctx)).resolves.toBe(true)
    expect(request.user?.roles).toEqual([Role.teacher])
    expect(request.user?.isPlatformAdmin).toBe(false)
  })

  it('ignora claims do token mesmo com vínculo vazio — o vínculo do polo é a única fonte (ID-08)', async () => {
    const verify = jest.fn().mockResolvedValue({ uid: 'u1', email: 'a@x.com', roles: [Role.admin] })
    const guard = makeGuard({ verify, dbUser: { uid: 'u1', disabled: false }, memberRoles: [] })
    const { ctx, request } = makeContext({ authorization: 'Bearer tok' })
    await guard.canActivate(ctx)
    expect(request.user?.roles).toEqual([])
  })

  it('consulta o vínculo do polo da requisição (e o da matriz) numa chamada só', async () => {
    const verify = jest.fn().mockResolvedValue({ uid: 'u1', email: 'a@x.com' })
    const members = { rolesHereAndInMatriz: jest.fn().mockResolvedValue({ roles: [Role.student], matrizRoles: null }) }
    const guard = makeGuard({ verify, dbUser: { uid: 'u1', disabled: false }, members })
    const { ctx } = makeContext({ authorization: 'Bearer tok' }, 't-b')
    await guard.canActivate(ctx)
    expect(members.rolesHereAndInMatriz).toHaveBeenCalledTimes(1)
    expect(members.rolesHereAndInMatriz).toHaveBeenCalledWith('t-b', 'u1')
  })

  it('admin da matriz é admin da plataforma: ganha admin no polo do endereço, sem vínculo com ele', async () => {
    const verify = jest.fn().mockResolvedValue({ uid: 'u1', email: 'a@x.com' })
    const guard = makeGuard({ verify, dbUser: { uid: 'u1', disabled: false, isPlatformAdmin: false }, memberRoles: null, matrizRoles: [Role.admin] })
    const { ctx, request } = makeContext({ authorization: 'Bearer tok' }, 't-b')
    await guard.canActivate(ctx)
    expect(request.user?.isPlatformAdmin).toBe(true)
    expect(request.user?.roles).toEqual([Role.admin])
  })

  it('professor ou aluno da matriz não é da plataforma', async () => {
    const verify = jest.fn().mockResolvedValue({ uid: 'u1', email: 'a@x.com' })
    const guard = makeGuard({ verify, dbUser: { uid: 'u1', disabled: false }, memberRoles: [Role.student], matrizRoles: [Role.teacher, Role.student] })
    const { ctx, request } = makeContext({ authorization: 'Bearer tok' }, 't-b')
    await guard.canActivate(ctx)
    expect(request.user?.isPlatformAdmin).toBe(false)
    expect(request.user?.roles).toEqual([Role.student])
  })

  it('sem vínculo no polo, nenhum papel', async () => {
    const verify = jest.fn().mockResolvedValue({ uid: 'u1', email: 'a@x.com' })
    const guard = makeGuard({ verify, dbUser: { uid: 'u1', disabled: false }, memberRoles: null })
    const { ctx, request } = makeContext({ authorization: 'Bearer tok' })
    await guard.canActivate(ctx)
    expect(request.user?.roles).toEqual([])
  })

  it('admin da plataforma ganha admin em polo sem vínculo', async () => {
    const verify = jest.fn().mockResolvedValue({ uid: 'u1', email: 'a@x.com' })
    const guard = makeGuard({ verify, dbUser: { uid: 'u1', disabled: false, isPlatformAdmin: true }, memberRoles: null })
    const { ctx, request } = makeContext({ authorization: 'Bearer tok' })
    await guard.canActivate(ctx)
    expect(request.user?.roles).toEqual([Role.admin])
    expect(request.user?.isPlatformAdmin).toBe(true)
  })

  it('sem registro no banco, não consulta vínculo e fica sem papel', async () => {
    const verify = jest.fn().mockResolvedValue({ uid: 'u1', email: 'a@x.com', roles: [Role.admin] })
    const members = { rolesHereAndInMatriz: jest.fn() }
    const guard = makeGuard({ verify, dbUser: null, members })
    const { ctx, request } = makeContext({ authorization: 'Bearer tok' })
    await guard.canActivate(ctx)
    expect(members.rolesHereAndInMatriz).not.toHaveBeenCalled()
    expect(request.user?.roles).toEqual([])
    expect(request.user?.isPlatformAdmin).toBe(false)
  })

  it('bloqueia usuário desabilitado', async () => {
    const verify = jest.fn().mockResolvedValue({ uid: 'u1', email: 'a@x.com' })
    const guard = makeGuard({ verify, dbUser: { uid: 'u1', roles: [Role.student], disabled: true } })
    const { ctx } = makeContext({ authorization: 'Bearer tok' })
    await expect(guard.canActivate(ctx)).rejects.toThrow('Conta desabilitada')
  })

  it('mapeia token expirado para 401', async () => {
    const verify = jest.fn().mockRejectedValue({ code: 'auth/id-token-expired' })
    const guard = makeGuard({ verify })
    const { ctx } = makeContext({ authorization: 'Bearer tok' })
    await expect(guard.canActivate(ctx)).rejects.toThrow('Token expirado. Faça login novamente')
  })
})
