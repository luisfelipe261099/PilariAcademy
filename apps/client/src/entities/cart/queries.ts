import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CheckoutRequest } from '@pilari/types'
import { checkout, fetchCartSummary } from './api'

export function useCartSummaryQuery(courseIds: string[], couponCode?: string) {
  return useQuery({
    queryKey: ['cart', 'summary', courseIds, couponCode ?? null] as const,
    queryFn: () => fetchCartSummary(courseIds, couponCode),
    enabled: courseIds.length > 0,
  })
}

export function useCheckoutMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CheckoutRequest) => checkout(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me', 'enrollments'] }),
  })
}
