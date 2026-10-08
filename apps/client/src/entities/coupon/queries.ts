import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createCoupon, deleteCoupon, listCoupons, updateCoupon, type CreateCouponInput } from './api'

export const COUPONS_KEY = ['admin', 'coupons'] as const

export const couponsQueryOptions = queryOptions({ queryKey: COUPONS_KEY, queryFn: listCoupons })

export function useCouponsQuery() {
  return useQuery(couponsQueryOptions)
}

export function useCreateCouponMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateCouponInput) => createCoupon(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: COUPONS_KEY }),
  })
}

export function useDeleteCouponMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteCoupon(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: COUPONS_KEY }),
  })
}

export function useToggleCouponMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => updateCoupon(id, { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: COUPONS_KEY }),
  })
}
