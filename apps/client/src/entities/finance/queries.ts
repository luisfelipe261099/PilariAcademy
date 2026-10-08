import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getAdminFinance, getInstructorEarnings, reconcileAsaas, registerPayout } from './api'

export const ADMIN_FINANCE_KEY = ['admin', 'finance'] as const

export function useAdminFinanceQuery(month?: string) {
  return useQuery({
    queryKey: [...ADMIN_FINANCE_KEY, month ?? 'current'] as const,
    queryFn: () => getAdminFinance(month),
  })
}

export function useRegisterPayoutMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { instructorId: string; amountInCents: number; note?: string }) => registerPayout(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ADMIN_FINANCE_KEY }),
  })
}

export function useReconcileAsaasMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: reconcileAsaas,
    onSuccess: () => qc.invalidateQueries({ queryKey: ADMIN_FINANCE_KEY }),
  })
}

export function useInstructorEarningsQuery() {
  return useQuery({ queryKey: ['instructor', 'earnings'] as const, queryFn: getInstructorEarnings })
}
