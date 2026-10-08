import type { PaymentMode } from '@pilari/types'

/** Tetos por meio. Espelham o que o server envia ao Asaas. */
const MAX_BY_MODE: Record<'cartao_parcelado' | 'boleto_parcelado', number> = {
  cartao_parcelado: 10,
  boleto_parcelado: 5,
}

/** Piso do Asaas por parcela: R$ 5,00 no cartão, R$ 10,00 no boleto. */
const MIN_BY_MODE: Record<'cartao_parcelado' | 'boleto_parcelado', number> = {
  cartao_parcelado: 500,
  boleto_parcelado: 1000,
}

/**
 * Maior número de parcelas que respeita o piso por parcela da modalidade, sem passar
 * do teto. 'avista' sempre devolve 1 (não parcela).
 */
export function maxInstallmentsFor(totalInCents: number, mode: PaymentMode): number {
  if (mode === 'avista') return 1
  const piso = MIN_BY_MODE[mode]
  return Math.max(1, Math.min(MAX_BY_MODE[mode], Math.floor(totalInCents / piso)))
}

/**
 * Texto da oferta de parcelamento no carrinho, ou `null` quando o total não permite
 * parcelar nem em 2x. O número de parcelas é o maior que respeita o piso do Asaas para
 * a modalidade — sem isso a vitrine prometeria "10x de R$ 3,00" numa cobrança que ele
 * recusa.
 */
export function installmentLabel(totalInCents: number, mode: PaymentMode): string | null {
  const n = maxInstallmentsFor(totalInCents, mode)
  if (n < 2) return null
  // Arredonda a parcela para CIMA: prometer menos do que o Asaas vai cobrar é pior
  // que a diferença de centavos que o próprio Asaas ajusta na última parcela.
  const parcela = Math.ceil(totalInCents / n)
  const valor = (parcela / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `até ${n}x de R$ ${valor}`
}
