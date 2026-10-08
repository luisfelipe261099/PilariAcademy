import { httpClient } from '@/shared/api/http-client'
import type { Classroom } from '@pilari/types'

export async function getClassroom(slug: string): Promise<Classroom> {
  const { data } = await httpClient.get<Classroom>(`/me/courses/${slug}/classroom`)
  return data
}

export async function setLessonProgress(lessonId: string, completed: boolean): Promise<{ completed: boolean }> {
  const { data } = await httpClient.put<{ completed: boolean }>(`/me/lessons/${lessonId}/progress`, { completed })
  return data
}
