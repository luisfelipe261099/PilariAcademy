import { Role } from '@pilari/types'
import type { AuthStatus } from '@/entities/auth'

/** Destino pós-login conforme precedência admin > teacher > demais. */
export function homeForRoles(roles: Role[]): '/admin' | '/instrutor' | '/dashboard' {
  if (roles.includes(Role.admin)) return '/admin'
  if (roles.includes(Role.teacher)) return '/instrutor'
  return '/dashboard'
}

export interface AccessState {
  status: AuthStatus
  profilePending: boolean
  profileError: boolean
  roles: Role[]
}

export type AccessDecision = 'loading' | 'redirect-login' | 'redirect-dashboard' | 'allow'

/** Decisão pura do RequireRole. Ordem: anon > carregando > erro > checagem do papel.
 *  O admin é superusuário: passa em qualquer gate de papel (ex.: editor do instrutor). */
export function roleAccessDecision(state: AccessState, required: Role): AccessDecision {
  if (state.status === 'anon') return 'redirect-login'
  if (state.status === 'checking' || state.profilePending) return 'loading'
  if (state.profileError) return 'redirect-dashboard'
  const allowed = state.roles.includes(required) || state.roles.includes(Role.admin)
  return allowed ? 'allow' : 'redirect-dashboard'
}

export interface RedirectState {
  profilePending: boolean
  profileError: boolean
  roles: Role[]
}

/** Alvo do RoleRedirect (login já autenticado). null = ainda carregando -> mostrar loader. */
export function postLoginTarget(state: RedirectState): '/admin' | '/instrutor' | '/dashboard' | null {
  if (state.profilePending) return null
  if (state.profileError) return '/dashboard'
  return homeForRoles(state.roles)
}

export interface PlatformAccessState {
  status: AuthStatus
  profilePending: boolean
  profileError: boolean
  isPlatformAdmin: boolean
  isMatriz: boolean
}

export type PlatformAccessDecision = 'loading' | 'redirect-login' | 'redirect-admin' | 'retry' | 'allow'

/** Console do Studio Pilari: só admin da plataforma e só no endereço da matriz. O backend continua sendo a validação real. */
export function platformAccessDecision(s: PlatformAccessState): PlatformAccessDecision {
  if (s.status === 'anon') return 'redirect-login'
  if (s.status === 'checking' || s.profilePending) return 'loading'
  // Falha passageira ao ler o perfil: oferece tentar de novo em vez de tirar a equipe do console.
  if (s.profileError) return 'retry'
  return s.isPlatformAdmin && s.isMatriz ? 'allow' : 'redirect-admin'
}
