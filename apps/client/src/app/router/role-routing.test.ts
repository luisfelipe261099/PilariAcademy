import { describe, it, expect } from 'vitest'
import { Role } from '@pilari/types'
import { homeForRoles, roleAccessDecision, postLoginTarget, platformAccessDecision } from './role-routing'

describe('homeForRoles', () => {
  it('com admin -> /admin', () => {
    expect(homeForRoles([Role.admin])).toBe('/admin')
    expect(homeForRoles([Role.admin, Role.student])).toBe('/admin')
  })
  it('teacher -> /instrutor, student/vazio -> /dashboard', () => {
    expect(homeForRoles([Role.student])).toBe('/dashboard')
    expect(homeForRoles([Role.teacher])).toBe('/instrutor')
    expect(homeForRoles([Role.admin, Role.teacher])).toBe('/admin')
    expect(homeForRoles([])).toBe('/dashboard')
  })
})

describe('roleAccessDecision', () => {
  const base = { profilePending: false, profileError: false, roles: [] as Role[] }
  it('anon -> redirect-login', () => {
    expect(roleAccessDecision({ ...base, status: 'anon' }, Role.admin)).toBe('redirect-login')
  })
  it('checking -> loading', () => {
    expect(roleAccessDecision({ ...base, status: 'checking', profilePending: true }, Role.admin)).toBe('loading')
  })
  it('perfil pendente -> loading', () => {
    expect(roleAccessDecision({ ...base, status: 'authenticated', profilePending: true }, Role.admin)).toBe('loading')
  })
  it('erro de perfil -> redirect-dashboard', () => {
    expect(roleAccessDecision({ ...base, status: 'authenticated', profileError: true }, Role.admin)).toBe('redirect-dashboard')
  })
  it('com o papel -> allow', () => {
    expect(roleAccessDecision({ ...base, status: 'authenticated', roles: [Role.admin] }, Role.admin)).toBe('allow')
  })
  it('sem o papel -> redirect-dashboard', () => {
    expect(roleAccessDecision({ ...base, status: 'authenticated', roles: [Role.student] }, Role.admin)).toBe('redirect-dashboard')
  })
  it('admin é superusuário: passa em gate de teacher', () => {
    expect(roleAccessDecision({ ...base, status: 'authenticated', roles: [Role.admin] }, Role.teacher)).toBe('allow')
  })
})

describe('postLoginTarget', () => {
  it('pendente -> null (loader)', () => {
    expect(postLoginTarget({ profilePending: true, profileError: false, roles: [] })).toBeNull()
  })
  it('erro -> /dashboard', () => {
    expect(postLoginTarget({ profilePending: false, profileError: true, roles: [] })).toBe('/dashboard')
  })
  it('admin -> /admin; student -> /dashboard', () => {
    expect(postLoginTarget({ profilePending: false, profileError: false, roles: [Role.admin] })).toBe('/admin')
    expect(postLoginTarget({ profilePending: false, profileError: false, roles: [Role.student] })).toBe('/dashboard')
  })
})

describe('platformAccessDecision', () => {
  const base = { status: 'authenticated' as const, profilePending: false, profileError: false, isPlatformAdmin: true, isMatriz: true }
  it('plataforma no host da matriz entra', () => {
    expect(platformAccessDecision(base)).toBe('allow')
  })
  it('admin comum ou host de polo volta para o painel', () => {
    expect(platformAccessDecision({ ...base, isPlatformAdmin: false })).toBe('redirect-admin')
    expect(platformAccessDecision({ ...base, isMatriz: false })).toBe('redirect-admin')
  })
  it('anônimo vai ao login e perfil carregando espera', () => {
    expect(platformAccessDecision({ ...base, status: 'anon' })).toBe('redirect-login')
    expect(platformAccessDecision({ ...base, profilePending: true })).toBe('loading')
  })
  it('sessão ainda sendo verificada (checking) espera, mesmo com o perfil já pronto', () => {
    expect(platformAccessDecision({ ...base, status: 'checking' })).toBe('loading')
  })
  it('erro ao carregar o perfil volta para o painel, mesmo que o último perfil conhecido fosse de plataforma', () => {
    expect(platformAccessDecision({ ...base, profileError: true })).toBe('retry')
  })
  it('a ordem das checagens: anon vence tudo, a espera vem antes do erro e o erro antes do papel', () => {
    expect(platformAccessDecision({ ...base, status: 'anon', profileError: true, profilePending: true })).toBe('redirect-login')
    expect(platformAccessDecision({ ...base, status: 'checking', profileError: true })).toBe('loading')
    expect(platformAccessDecision({ ...base, profilePending: true, profileError: true })).toBe('loading')
  })
})
