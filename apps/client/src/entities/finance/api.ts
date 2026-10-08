import { httpClient } from '@/shared/api/http-client'
import type { AdminFinance, AsaasReconcileResult, InstructorEarnings, PayoutRecord } from '@pilari/types'

export async function getAdminFinance(month?: string): Promise<AdminFinance> {
  const { data } = await httpClient.get<AdminFinance>('/admin/finance', { params: month ? { month } : undefined })
  return data
}

export async function registerPayout(input: { instructorId: string; amountInCents: number; note?: string }): Promise<PayoutRecord> {
  const { data } = await httpClient.post<{ payout: PayoutRecord }>('/admin/payouts', input)
  return data.payout
}

export async function getInstructorEarnings(): Promise<InstructorEarnings> {
  const { data } = await httpClient.get<InstructorEarnings>('/instructor/earnings')
  return data
}

/** Reconciliação pull: libera pedidos pending já pagos no Asaas (webhook perdido). */
export async function reconcileAsaas(): Promise<AsaasReconcileResult> {
  const { data } = await httpClient.post<AsaasReconcileResult>('/admin/reconcile-asaas')
  return data
}
