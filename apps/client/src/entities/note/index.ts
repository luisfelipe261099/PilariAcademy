import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { httpClient } from '@/shared/api/http-client'
import type { LessonNote } from '@pilari/types'

export async function getNotes(slug: string): Promise<LessonNote[]> {
  const { data } = await httpClient.get<{ notes: LessonNote[] }>(`/me/courses/${slug}/notes`)
  return data.notes
}
export async function createNote(lessonId: string, atSec: number, body: string): Promise<LessonNote> {
  const { data } = await httpClient.post<{ note: LessonNote }>(`/me/lessons/${lessonId}/notes`, { atSec, body })
  return data.note
}
export async function deleteNote(id: string): Promise<void> {
  await httpClient.delete(`/me/notes/${id}`)
}

export const notesKey = (slug: string) => ['notes', slug] as const

export function useNotesQuery(slug: string, enabled = true) {
  return useQuery({ queryKey: notesKey(slug), queryFn: () => getNotes(slug), enabled: enabled && Boolean(slug), retry: false })
}
export function useCreateNoteMutation(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ lessonId, atSec, body }: { lessonId: string; atSec: number; body: string }) => createNote(lessonId, atSec, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: notesKey(slug) }),
  })
}
export function useDeleteNoteMutation(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteNote(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: notesKey(slug) }),
  })
}
