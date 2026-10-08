import { type AdminUserDetail, type AuthUser, Role } from '@pilari/types'
import { maskCpf } from '../../common/cpf'
import { users } from '../../db/schema'

type UserRow = typeof users.$inferSelect

/**
 * Contrato público do usuário. `roles` são os papéis no polo do endereço e `isPlatformAdmin` é o EFETIVO (sinal do
 * cadastro ou admin da matriz, ver `isEffectivePlatformAdmin`), os dois decididos por quem chama: a coluna sozinha não
 * diz se a pessoa é da plataforma.
 */
export function toAuthUser(row: UserRow, roles: Role[], isPlatformAdmin: boolean): AuthUser {
  return {
    uid: row.uid,
    email: row.email,
    displayName: row.displayName ?? null,
    photoUrl: row.photoUrl ?? null,
    roles,
    isPlatformAdmin,
  }
}

/**
 * Perfil completo para o admin: AuthUser + CPF (só dígitos), status e data de cadastro. `maskCpf` troca o CPF pela
 * máscara do documento público (pessoa compartilhada vista por um polo, B2).
 */
export function toAdminUserDetail(row: UserRow, roles: Role[], isPlatformAdmin: boolean, opts: { maskCpf?: boolean } = {}): AdminUserDetail {
  const cpf = (row.cpf ?? '').replace(/\D/g, '')
  return {
    ...toAuthUser(row, roles, isPlatformAdmin),
    cpf: (opts.maskCpf ? maskCpf(cpf) : cpf) || null,
    disabled: !!row.disabled,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
  }
}
