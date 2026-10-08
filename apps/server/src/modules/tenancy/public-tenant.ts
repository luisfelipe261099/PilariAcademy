import type { PublicTenant } from '@pilari/types'
import { brandTokens } from './brand-tokens'
import { publicBranding } from './branding'
import { salesEnabled } from './sales'
import type { TenantContext } from './tenant-context'

/** O polo como o site o enxerga: GET /api/tenant e bloco tenant-data do index.html. */
export function toPublicTenant(t: TenantContext): PublicTenant {
  return {
    slug: t.slug,
    name: t.name,
    isMatriz: t.isMatriz,
    status: t.status,
    salesEnabled: salesEnabled(t),
    branding: publicBranding(t.branding, t.updatedAt.getTime()),
    // A matriz usa o tema do app como está: nenhum token sobrescrito.
    themeCss: t.isMatriz ? null : brandTokens(t.branding.primaryColor, t.branding.accentColor),
  }
}
