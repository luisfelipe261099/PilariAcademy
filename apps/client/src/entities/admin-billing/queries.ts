import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cancelCharge, createCharge, getStudentFinance, searchStudents, type NovaCobranca } from './api'
import { ADMIN_ORDERS_KEY } from '@/entities/admin-orders'

const KEY = ['admin-billing'] as const

export function useStudentSearchQuery(q: string) {
  return useQuery({
    queryKey: [...KEY, 'search', q] as const,
    queryFn: () => searchStudents(q),
    // O servidor já ignora termo curto; não gastar requisição enquanto se digita.
    enabled: q.trim().length >= 3,
  })
}

export function useStudentFinanceQuery(uid: string | null) {
  return useQuery({
    queryKey: [...KEY, 'finance', uid] as const,
    queryFn: () => getStudentFinance(uid as string),
    enabled: uid !== null,
  })
}

export function useCancelChargeMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (orderId: string) => cancelCharge(orderId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY })
      void qc.invalidateQueries({ queryKey: ADMIN_ORDERS_KEY })
    },
  })
}

export function useCreateChargeMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: NovaCobranca) => createCharge(input),
    // Invalida a raiz: a ficha do aluno e os totais mudam, e a lista geral de cobranças
    // passa a ter a linha nova.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY })
      void qc.invalidateQueries({ queryKey: ADMIN_ORDERS_KEY })
    },
  })
}
