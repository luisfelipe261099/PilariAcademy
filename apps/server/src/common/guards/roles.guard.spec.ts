/// <reference types="jest" />
import { ForbiddenException, type ExecutionContext } from '@nestjs/common'
import { Role } from '@pilari/types'
import { RolesGuard } from './roles.guard'
import { PUBLIC_KEY } from '../decorators/public.decorator'
import { AUTHENTICATED_KEY } from '../decorators/authenticated.decorator'
import { ROLES_KEY } from '../decorators/roles.decorator'
import { PLATFORM_ADMIN_KEY } from '../decorators/platform-admin.decorator'

function ctx(user?: { uid?: string; roles?: Role[]; isPlatformAdmin?: boolean }): ExecutionContext {
  return {
    getHandler: () => 'handler',
    getClass: () => ({ name: 'C' }),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext
}

function guard(meta: { public?: boolean; authenticated?: boolean; roles?: Role[]; platform?: boolean }): RolesGuard {
  const reflector = {
    getAllAndOverride: (key: string) => {
      if (key === PUBLIC_KEY) return meta.public
      if (key === PLATFORM_ADMIN_KEY) return meta.platform
      if (key === AUTHENTICATED_KEY) return meta.authenticated
      if (key === ROLES_KEY) return meta.roles
      return undefined
    },
  }
  return new RolesGuard(reflector as never)
}

/** Toda negação é o 403 em português com `code` estável (B5), não o "Forbidden resource" do Nest. */
function negado(fn: () => unknown): void {
  let erro: unknown
  try {
    fn()
  } catch (e) {
    erro = e
  }
  expect(erro).toBeInstanceOf(ForbiddenException)
  expect((erro as ForbiddenException).getResponse()).toEqual({
    statusCode: 403,
    code: 'FORBIDDEN',
    message: 'Você não tem permissão para esta ação neste endereço.',
  })
}

describe('RolesGuard (deny-by-default global)', () => {
  it('@Public → permite', () => {
    expect(guard({ public: true }).canActivate(ctx())).toBe(true)
  })

  it('@Authenticated → permite qualquer logado', () => {
    expect(guard({ authenticated: true }).canActivate(ctx({ uid: 'u1', roles: [Role.student] }))).toBe(true)
  })

  it('@Roles com papel compatível → permite', () => {
    expect(guard({ roles: [Role.admin] }).canActivate(ctx({ uid: 'u1', roles: [Role.admin] }))).toBe(true)
  })

  it('@Roles sem papel compatível → nega com o 403 em português', () => {
    negado(() => guard({ roles: [Role.admin] }).canActivate(ctx({ uid: 'u1', roles: [Role.student] })))
  })

  it('rota SEM @Public/@Authenticated/@Roles → NEGA por padrão (safety net)', () => {
    negado(() => guard({}).canActivate(ctx({ uid: 'u1', roles: [Role.student] })))
  })

  it('@PlatformAdmin nega admin de polo', () => {
    negado(() => guard({ platform: true }).canActivate(ctx({ uid: 'u1', roles: [Role.admin], isPlatformAdmin: false })))
  })

  it('@PlatformAdmin libera a equipe da plataforma', () => {
    expect(guard({ platform: true }).canActivate(ctx({ uid: 'u1', roles: [Role.admin], isPlatformAdmin: true }))).toBe(true)
  })

  it('@PlatformAdmin vence o @Authenticated da classe', () => {
    negado(() => guard({ platform: true, authenticated: true }).canActivate(ctx({ uid: 'u1', roles: [Role.student] })))
  })
})
