const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/** Centavos → "R$ 97,00". Zero vira "Grátis". Use para PREÇO de curso. */
export function formatPriceBRL(cents: number): string {
  if (cents === 0) return 'Grátis'
  // Intl separa o símbolo do valor com espaço não-quebrável (U+00A0/U+202F, ambos
  // cobertos por \s); normaliza para espaço comum para um texto previsível.
  return BRL.format(cents / 100).replace(/\s/g, ' ')
}

/** Centavos → "R$ 0,00" (sempre moeda, inclusive zero). Use para VALORES financeiros. */
export function formatMoneyBRL(cents: number): string {
  return BRL.format(cents / 100).replace(/\s/g, ' ')
}
