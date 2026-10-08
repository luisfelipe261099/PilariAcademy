import { queryOptions, useQuery } from '@tanstack/react-query'
import { getAdminLogs } from './api'

export const adminLogsQueryOptions = queryOptions({ queryKey: ['admin', 'logs'] as const, queryFn: getAdminLogs })

export function useAdminLogsQuery() {
  return useQuery(adminLogsQueryOptions)
}
