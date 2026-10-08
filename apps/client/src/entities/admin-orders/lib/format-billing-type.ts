const LABELS: Record<string, string> = {
  CREDIT_CARD: 'Cartão',
  BOLETO: 'Boleto',
  PIX: 'Pix',
}

/**
 * Rótulo da forma de pagamento para a tabela de cobranças do admin.
 *
 * `UNDEFINED` é o estado "o aluno ainda não escolheu" — é o que gravamos ao criar o link,
 * e só vira a forma real quando o pagamento confirma. Vira travessão, não rótulo.
 * Forma desconhecida cai no valor cru: melhor o admin ver `DEBIT_CARD` do que um traço
 * que esconde uma forma de pagamento nova.
 */
export function formatBillingType(billingType: string | null, installmentCount: number | null): string {
  if (!billingType || billingType === 'UNDEFINED') return '—'
  const label = LABELS[billingType] ?? billingType
  return installmentCount && installmentCount > 1 ? `${label} · ${installmentCount}x` : label
}
