import { httpClient } from '@/shared/api/http-client'
import type { AdminCourseRow, AdminStats } from '@pilari/types'

export async function getAdminStats(): Promise<AdminStats> {
  const { data } = await httpClient.get<AdminStats>('/admin/stats')
  return data
}

export async function getAdminCourses(): Promise<AdminCourseRow[]> {
  const { data } = await httpClient.get<{ courses: AdminCourseRow[] }>('/admin/courses')
  return data.courses
}

export async function setCourseCommission(courseId: string, commissionPercent: number): Promise<void> {
  await httpClient.patch(`/admin/courses/${courseId}/commission`, { commissionPercent })
}

export async function setCourseOwner(courseId: string, instructorId: string): Promise<void> {
  await httpClient.patch(`/admin/courses/${courseId}/owner`, { instructorId })
}
