import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { httpClient } from '@/shared/api/http-client'
import type { Announcement } from '@pilari/types'

// ── aluno ────────────────────────────────────────────────────────────────────
export async function getStudentAnnouncements(slug: string): Promise<Announcement[]> {
  const { data } = await httpClient.get<{ announcements: Announcement[] }>(`/me/courses/${slug}/announcements`)
  return data.announcements
}
// ── instrutor ────────────────────────────────────────────────────────────────
export async function getInstructorAnnouncements(courseId: string): Promise<Announcement[]> {
  const { data } = await httpClient.get<{ announcements: Announcement[] }>(`/instructor/courses/${courseId}/announcements`)
  return data.announcements
}
export async function createAnnouncement(courseId: string, title: string, body: string): Promise<Announcement> {
  const { data } = await httpClient.post<{ announcement: Announcement }>(`/instructor/courses/${courseId}/announcements`, { title, body })
  return data.announcement
}
export async function deleteAnnouncement(id: string): Promise<void> {
  await httpClient.delete(`/instructor/announcements/${id}`)
}

export const studentAnnouncementsKey = (slug: string) => ['announcements', 'student', slug] as const
export const instructorAnnouncementsKey = (courseId: string) => ['announcements', 'instructor', courseId] as const

export function useStudentAnnouncementsQuery(slug: string, enabled = true) {
  return useQuery({ queryKey: studentAnnouncementsKey(slug), queryFn: () => getStudentAnnouncements(slug), enabled: enabled && Boolean(slug), retry: false })
}
export function useInstructorAnnouncementsQuery(courseId: string) {
  return useQuery({ queryKey: instructorAnnouncementsKey(courseId), queryFn: () => getInstructorAnnouncements(courseId), enabled: Boolean(courseId), retry: false })
}
export function useCreateAnnouncementMutation(courseId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ title, body }: { title: string; body: string }) => createAnnouncement(courseId, title, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: instructorAnnouncementsKey(courseId) }),
  })
}
export function useDeleteAnnouncementMutation(courseId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteAnnouncement(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: instructorAnnouncementsKey(courseId) }),
  })
}
