import { httpClient } from '@/shared/api/http-client'
import type { AuthoringModule, CourseStatus, InstructorCourse, UploadTicket } from '@pilari/types'

export interface CreateCourseInput {
  title: string
  subtitle?: string
  description?: string
  categoryId?: string
  priceInCents?: number
}
export type UpdateCourseInput = Partial<{
  title: string
  subtitle: string | null
  description: string | null
  categoryId: string | null
  priceInCents: number
  promoPriceInCents: number | null
  promoEndsAt: string | null
  coverImageUrl: string | null
  coverFocus: string | null
  availableAt: string | null
  /** 2ª assinatura do certificado. Só admin: o servidor descarta se vier de instrutor. */
  coordinatorName: string | null
  coordinatorRole: string | null
  coordinatorSignaturePath: string | null
  workloadHours: number | null
  /** Tutor de voz com IA (só admin; o servidor ignora para instrutor). */
  tutorEnabled: boolean
}>
export type UpdateLessonInput = Partial<{
  title: string
  description: string | null
  videoUrl: string | null
  durationSec: number
  isFreePreview: boolean
}>

export async function listInstructorCourses(): Promise<InstructorCourse[]> {
  const { data } = await httpClient.get<{ courses: InstructorCourse[] }>('/instructor/courses')
  return data.courses
}
export async function createInstructorCourse(input: CreateCourseInput): Promise<InstructorCourse> {
  const { data } = await httpClient.post<{ course: InstructorCourse }>('/instructor/courses', input)
  return data.course
}
export async function getInstructorCourse(id: string): Promise<InstructorCourse> {
  const { data } = await httpClient.get<{ course: InstructorCourse }>(`/instructor/courses/${id}/meta`)
  return data.course
}
export async function getCourseStructure(id: string): Promise<AuthoringModule[]> {
  const { data } = await httpClient.get<{ modules: AuthoringModule[] }>(`/instructor/courses/${id}`)
  return data.modules
}
export async function updateCourseMeta(id: string, patch: UpdateCourseInput): Promise<InstructorCourse> {
  const { data } = await httpClient.patch<{ course: InstructorCourse }>(`/instructor/courses/${id}`, patch)
  return data.course
}
export async function setCourseStatus(id: string, status: CourseStatus): Promise<void> {
  await httpClient.patch(`/instructor/courses/${id}/status`, { status })
}
export async function deleteCourse(id: string): Promise<void> {
  await httpClient.delete(`/instructor/courses/${id}`)
}

export async function createModule(courseId: string, title: string): Promise<{ id: string }> {
  const { data } = await httpClient.post<{ id: string }>(`/instructor/courses/${courseId}/modules`, { title })
  return data
}
export async function updateModule(moduleId: string, title: string): Promise<void> {
  await httpClient.patch(`/instructor/modules/${moduleId}`, { title })
}
export async function setModuleRelease(moduleId: string, availableAt: string | null): Promise<void> {
  await httpClient.patch(`/instructor/modules/${moduleId}/release`, { availableAt })
}
export async function deleteModule(moduleId: string): Promise<void> {
  await httpClient.delete(`/instructor/modules/${moduleId}`)
}
export async function reorderModules(courseId: string, orderedIds: string[]): Promise<void> {
  await httpClient.put(`/instructor/courses/${courseId}/modules/reorder`, { orderedIds })
}

export async function createLesson(moduleId: string, title: string): Promise<{ id: string }> {
  const { data } = await httpClient.post<{ id: string }>(`/instructor/modules/${moduleId}/lessons`, { title })
  return data
}
export async function updateLesson(lessonId: string, patch: UpdateLessonInput): Promise<void> {
  await httpClient.patch(`/instructor/lessons/${lessonId}`, patch)
}
export async function deleteLesson(lessonId: string): Promise<void> {
  await httpClient.delete(`/instructor/lessons/${lessonId}`)
}
export async function reorderLessons(moduleId: string, orderedIds: string[]): Promise<void> {
  await httpClient.put(`/instructor/modules/${moduleId}/lessons/reorder`, { orderedIds })
}

export async function addAttachment(lessonId: string, fileName: string, fileUrl: string): Promise<{ id: string }> {
  const { data } = await httpClient.post<{ id: string }>(`/instructor/lessons/${lessonId}/attachments`, { fileName, fileUrl })
  return data
}
export async function deleteAttachment(attachmentId: string): Promise<void> {
  await httpClient.delete(`/instructor/attachments/${attachmentId}`)
}

export async function requestUploadUrl(input: {
  kind: 'video' | 'cover' | 'attachment' | 'signature'
  courseId: string
  fileName: string
  contentType: string
}): Promise<UploadTicket> {
  const { data } = await httpClient.post<UploadTicket>('/instructor/upload-url', input)
  return data
}
