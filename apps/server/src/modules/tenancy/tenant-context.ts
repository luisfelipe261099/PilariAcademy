import type { TenantBranding, TenantStatus } from '@pilari/types'
import type { tenants } from '../../db/schema'
import { EMPTY_BRANDING } from './branding'

/** O polo da requisição, resolvido pelo endereço (req.tenant). */
export interface TenantContext {
  id: string
  slug: string
  name: string
  isMatriz: boolean
  status: TenantStatus
  branding: TenantBranding
  updatedAt: Date
}

export function toTenantContext(row: typeof tenants.$inferSelect): TenantContext {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    isMatriz: !!row.isMatriz,
    status: row.status,
    branding: { ...EMPTY_BRANDING, ...(row.branding ?? {}) },
    updatedAt: row.updatedAt ?? new Date(0),
  }
}
