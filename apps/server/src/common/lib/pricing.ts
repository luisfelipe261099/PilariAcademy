/** Dados de preço de um curso (subconjunto da linha de courses). */
export interface PricedCourse {
  priceInCents: number
  promoPriceInCents: number | null
  promoEndsAt: Date | null
}

/** A promoção está ativa? (preço promocional setado, menor que o normal e dentro do prazo) */
export function promoActive(c: PricedCourse, now = new Date()): boolean {
  if (c.promoPriceInCents == null) return false
  if (c.promoPriceInCents >= c.priceInCents) return false
  if (c.promoEndsAt && c.promoEndsAt.getTime() <= now.getTime()) return false
  return true
}

/** Preço cobrado: promocional quando a promo está ativa; senão o normal. */
export function effectivePriceCents(c: PricedCourse, now = new Date()): number {
  return promoActive(c, now) ? (c.promoPriceInCents as number) : c.priceInCents
}

/** Preço "de" (riscado) quando em promoção; null fora de promoção. */
export function listPriceCents(c: PricedCourse, now = new Date()): number | null {
  return promoActive(c, now) ? c.priceInCents : null
}
