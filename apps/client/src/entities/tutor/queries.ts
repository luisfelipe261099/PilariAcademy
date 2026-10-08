import { useQuery } from '@tanstack/react-query'
import { getTutorInfo } from './api'

export function useTutorInfoQuery(slug: string) {
  return useQuery({
    queryKey: ['tutor', slug] as const,
    queryFn: () => getTutorInfo(slug),
    enabled: Boolean(slug),
    retry: false,
  })
}
