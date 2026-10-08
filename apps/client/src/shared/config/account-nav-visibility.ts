import type { AccountNavItem } from './account-nav'

/** Itens do menu do aluno para o polo do endereço: sem venda online, o Financeiro (pedidos e carnês) não entra. */
export function visibleAccountNav(items: AccountNavItem[], ctx: { salesEnabled: boolean }): AccountNavItem[] {
  return items.filter((i) => i.audience === 'aluno' || ctx.salesEnabled)
}
