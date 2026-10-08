import { Role } from '@pilari/types'
import type { DecodedFirebaseUser } from './user.type'
import type { TenantContext } from '../../modules/tenancy/tenant-context'

/** Quem age e em qual polo. Services de domínio recebem isto em vez de (uid, isAdmin). */
export interface Actor {
  uid: string
  tenantId: string
  isMatriz: boolean
  /** Admin DESTE polo (inclui admin da plataforma). */
  isAdmin: boolean
  isPlatformAdmin: boolean
}

export function actorOf(user: DecodedFirebaseUser, tenant: Pick<TenantContext, 'id' | 'isMatriz'>): Actor {
  return {
    uid: user.uid,
    tenantId: tenant.id,
    isMatriz: tenant.isMatriz,
    isAdmin: (user.roles ?? []).includes(Role.admin),
    isPlatformAdmin: user.isPlatformAdmin === true,
  }
}
