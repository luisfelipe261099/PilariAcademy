import type { TenantContext } from './tenant-context'

/**
 * Etapa 1: só a matriz vende pelo site. A etapa 2 (recebimento por polo) passa a decidir pela
 * configuração de pagamento do polo. Este é o ÚNICO lugar dessa regra.
 *
 * SALES_DISABLED=1 desliga a venda online também na matriz (antes de existir conta de pagamento): a página do curso
 * troca o "Comprar" pelo contato de matrícula e o carrinho/checkout recusam, como num polo sem venda.
 */
export function salesEnabled(t: Pick<TenantContext, 'isMatriz' | 'status'>, desligadas = process.env.SALES_DISABLED === '1'): boolean {
  return t.isMatriz && t.status === 'active' && !desligadas
}

/** Polo suspenso fecha a loja (catálogo, página de curso, carrinho e checkout). */
export function storefrontOpen(t: Pick<TenantContext, 'status'>): boolean {
  return t.status === 'active'
}
