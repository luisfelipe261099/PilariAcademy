import type { AdminNavAudience, AdminNavItem } from './admin-nav'
import { REDE_HABILITADA } from './features'

export interface AdminNavContext {
  isPlatformAdmin: boolean
  isMatriz: boolean
  salesEnabled: boolean
}

export function canSeeAdminItem(audience: AdminNavAudience, ctx: AdminNavContext): boolean {
  switch (audience) {
    case 'polo':
      return true
    case 'vendas':
      return ctx.salesEnabled
    case 'polo-parceiro':
      return !ctx.isMatriz
    case 'plataforma':
      return ctx.isPlatformAdmin && ctx.isMatriz
  }
}

/** Itens visíveis para o contexto. As telas da rede só aparecem com a rede ligada (`rede`, padrão: REDE_HABILITADA). */
export function visibleAdminNav(items: AdminNavItem[], ctx: AdminNavContext, rede: boolean = REDE_HABILITADA): AdminNavItem[] {
  return items.filter((i) => (rede || !i.rede) && canSeeAdminItem(i.audience, ctx))
}
