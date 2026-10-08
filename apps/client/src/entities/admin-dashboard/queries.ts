import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getAdminCourses, getAdminStats, setCourseCommission, setCourseOwner } from './api'

export const ADMIN_COURSES_KEY = ['admin', 'all-courses'] as const
export const adminStatsQueryOptions = queryOptions({ queryKey: ['admin', 'stats'] as const, queryFn: getAdminStats })
export const adminCoursesQueryOptions = queryOptions({ queryKey: ADMIN_COURSES_KEY, queryFn: getAdminCourses })

export function useAdminStatsQuery() {
  return useQuery(adminStatsQueryOptions)
}
export function useAdminCoursesQuery() {
  return useQuery(adminCoursesQueryOptions)
}
export function useSetCommissionMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ courseId, commissionPercent }: { courseId: string; commissionPercent: number }) => setCourseCommission(courseId, commissionPercent),
    onSuccess: () => qc.invalidateQueries({ queryKey: ADMIN_COURSES_KEY }),
  })
}
export function useSetOwnerMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ courseId, instructorId }: { courseId: string; instructorId: string }) => setCourseOwner(courseId, instructorId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ADMIN_COURSES_KEY }),
  })
}
