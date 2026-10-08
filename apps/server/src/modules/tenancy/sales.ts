import type { TenantContext } from './tenant-context'

/**
 * Etapa 1: só a matriz vende pelo site. A etapa 2 (recebimento por polo) passa a decidir pela
 * configuração de pagamento do polo. Este é o ÚNICO lugar dessa regra.
 */
export function salesEnabled(t: Pick<TenantContext, 'isMatriz' | 'status'>): boolean {
  return t.isMatriz && t.status === 'active'
}

/** Polo suspenso fecha a loja (catálogo, página de curso, carrinho e checkout). */
export function storefrontOpen(t: Pick<TenantContext, 'status'>): boolean {
  return t.status === 'active'
}
