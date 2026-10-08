import { httpClient } from '@/shared/api/http-client'
import type { CartSummary, CheckoutRequest, CheckoutResult } from '@pilari/types'

export async function fetchCartSummary(courseIds: string[], couponCode?: string): Promise<CartSummary> {
  const { data } = await httpClient.post<CartSummary>('/cart/summary', { courseIds, couponCode })
  return data
}

export async function checkout(input: CheckoutRequest): Promise<CheckoutResult> {
  const { data } = await httpClient.post<CheckoutResult>('/checkout', input)
  return data
}
