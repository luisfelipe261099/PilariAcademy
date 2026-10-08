import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getAdminOrders, settleOrder, cancelOrder, settleCarne } from './api'

export const ADMIN_ORDERS_KEY = ['admin', 'orders'] as const

export function useAdminOrdersQuery() {
  return useQuery({ queryKey: ADMIN_ORDERS_KEY, queryFn: getAdminOrders })
}

// Baixa/cancelamento mudam o financeiro também → invalida orders + finance.
function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ADMIN_ORDERS_KEY })
  void qc.invalidateQueries({ queryKey: ['admin', 'finance'] })
}

export function useSettleOrderMutation() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: settleOrder, onSuccess: () => invalidateAll(qc) })
}

export function useCancelOrderMutation() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: cancelOrder, onSuccess: () => invalidateAll(qc) })
}

export function useSettleCarneMutation() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: settleCarne, onSuccess: () => invalidateAll(qc) })
}
