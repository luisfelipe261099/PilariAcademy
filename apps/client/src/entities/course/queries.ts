import { queryOptions, useQuery } from '@tanstack/react-query'
import { getCourse, listCourses, type CourseFilters } from './api'

export const COURSES_KEY = ['courses'] as const

export function coursesQueryOptions(filters: CourseFilters = {}) {
  return queryOptions({
    queryKey: [...COURSES_KEY, filters] as const,
    queryFn: () => listCourses(filters),
  })
}

export function useCoursesQuery(filters: CourseFilters = {}) {
  return useQuery(coursesQueryOptions(filters))
}

export function courseQueryOptions(slug: string) {
  return queryOptions({
    queryKey: [...COURSES_KEY, 'detail', slug] as const,
    queryFn: () => getCourse(slug),
  })
}

export function useCourseQuery(slug: string) {
  return useQuery({ ...courseQueryOptions(slug), enabled: Boolean(slug) })
}
