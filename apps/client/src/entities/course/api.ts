import { httpClient } from '@/shared/api/http-client'
import type { CourseDetail, CourseKind, CourseSummary } from '@pilari/types'

export interface CourseFilters {
  category?: string
  kind?: CourseKind
}

export async function listCourses(filters: CourseFilters = {}): Promise<CourseSummary[]> {
  const { data } = await httpClient.get<{ courses: CourseSummary[] }>('/courses', { params: filters })
  return data.courses
}

export async function getCourse(slug: string): Promise<CourseDetail> {
  const { data } = await httpClient.get<{ course: CourseDetail }>(`/courses/${slug}`)
  return data.course
}
