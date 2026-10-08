import { httpClient } from '@/shared/api/http-client'
import type { AuditLog } from '@pilari/types'

export async function getAdminLogs(): Promise<AuditLog[]> {
  const { data } = await httpClient.get<{ logs: AuditLog[] }>('/admin/logs')
  return data.logs
}
