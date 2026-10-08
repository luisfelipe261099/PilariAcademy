import { queryOptions, useQuery } from '@tanstack/react-query'
import { listMyEnrollments } from './api'

export const MY_ENROLLMENTS_KEY = ['me', 'enrollments'] as const

export const myEnrollmentsQueryOptions = queryOptions({
  queryKey: MY_ENROLLMENTS_KEY,
  queryFn: listMyEnrollments,
})

export function useMyEnrollmentsQuery() {
  return useQuery(myEnrollmentsQueryOptions)
}
