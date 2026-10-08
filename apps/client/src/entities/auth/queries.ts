import { queryOptions, useQuery } from '@tanstack/react-query'
import { fetchMe } from './api'
import { useAuthStore } from './model'

export const meQueryOptions = queryOptions({
  queryKey: ['auth', 'me'],
  queryFn: fetchMe,
})

export function useMeQuery() {
  const status = useAuthStore((s) => s.status)
  return useQuery({ ...meQueryOptions, enabled: status === 'authenticated' })
}
