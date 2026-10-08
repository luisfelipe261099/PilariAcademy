import { httpClient } from '@/shared/api/http-client'
import type { AdminOrderRow } from '@pilari/types'

export async function getAdminOrders(): Promise<AdminOrderRow[]> {
  const { data } = await httpClient.get<{ orders: AdminOrderRow[] }>('/admin/orders')
  return data.orders
}

/** Baixa manual: marca o pedido como pago (libera acesso + credita repasse). */
export async function settleOrder(orderId: string): Promise<void> {
  await httpClient.post(`/admin/orders/${orderId}/settle`)
}

export async function cancelOrder(orderId: string): Promise<void> {
  await httpClient.post(`/admin/orders/${orderId}/cancel`)
}

/** Quitação manual de carnê: carimba settledAt sem passar pelo Asaas (pagou por fora, renegociou, ou webhook perdido). */
export async function settleCarne(orderId: string): Promise<void> {
  await httpClient.post(`/admin/orders/${orderId}/settle-carne`)
}
