import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createInstructorCourse, getCourseStructure, getInstructorCourse, listInstructorCourses, type CreateCourseInput } from './api'

export const INSTRUCTOR_COURSES_KEY = ['instructor', 'courses'] as const
export const structureKey = (id: string) => ['instructor', 'structure', id] as const
export const courseMetaKey = (id: string) => ['instructor', 'course-meta', id] as const

export const instructorCoursesQueryOptions = queryOptions({
  queryKey: INSTRUCTOR_COURSES_KEY,
  queryFn: listInstructorCourses,
})

export function useInstructorCoursesQuery() {
  return useQuery(instructorCoursesQueryOptions)
}

export function useCreateCourseMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateCourseInput) => createInstructorCourse(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: INSTRUCTOR_COURSES_KEY }),
  })
}

/** Um curso isolado (admin-aware): permite o admin abrir o editor de qualquer curso. */
export function useInstructorCourseQuery(id: string) {
  return useQuery({
    queryKey: courseMetaKey(id),
    queryFn: () => getInstructorCourse(id),
    enabled: Boolean(id),
  })
}

export function useCourseStructureQuery(id: string) {
  return useQuery({
    queryKey: structureKey(id),
    queryFn: () => getCourseStructure(id),
    enabled: Boolean(id),
  })
}

/** Helper p/ invalidar a estrutura após qualquer mutação de currículo. */
export function useInvalidateStructure(courseId: string) {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: structureKey(courseId) })
}
