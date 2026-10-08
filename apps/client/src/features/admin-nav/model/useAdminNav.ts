import { useMeQuery } from '@/entities/auth'
import { useTenant } from '@/entities/tenant'
import { ADMIN_NAV, type AdminNavItem } from '@/shared/config/admin-nav'
import { visibleAdminNav } from '@/shared/config/admin-nav-visibility'

/** Itens do menu do admin para quem está logado, no polo do endereço. */
export function useAdminNav(): AdminNavItem[] {
  const tenant = useTenant()
  const { data } = useMeQuery()
  return visibleAdminNav(ADMIN_NAV, {
    isPlatformAdmin: data?.user?.isPlatformAdmin ?? false,
    isMatriz: tenant.isMatriz,
    salesEnabled: tenant.salesEnabled,
  })
}
