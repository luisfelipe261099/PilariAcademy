import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getConversations, getInstructorThread, getStudentThread, sendInstructorMessage, sendStudentMessage,
} from './api'

export const studentThreadKey = (slug: string) => ['messages', 'student', slug] as const
export const conversationsKey = ['messages', 'conversations'] as const
export const instructorThreadKey = (courseId: string, studentId: string) => ['messages', 'instructor', courseId, studentId] as const

// Polling leve dá quase-tempo-real sem websockets.
const POLL_MS = 15000

// ── aluno ────────────────────────────────────────────────────────────────────
export function useStudentThreadQuery(slug: string) {
  return useQuery({
    queryKey: studentThreadKey(slug),
    queryFn: () => getStudentThread(slug),
    enabled: Boolean(slug),
    refetchInterval: POLL_MS,
  })
}
export function useSendStudentMessageMutation(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: string) => sendStudentMessage(slug, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: studentThreadKey(slug) }),
  })
}

// ── instrutor ────────────────────────────────────────────────────────────────
export function useConversationsQuery() {
  return useQuery({ queryKey: conversationsKey, queryFn: getConversations, refetchInterval: POLL_MS })
}
export function useInstructorThreadQuery(courseId: string, studentId: string) {
  return useQuery({
    queryKey: instructorThreadKey(courseId, studentId),
    queryFn: () => getInstructorThread(courseId, studentId),
    enabled: Boolean(courseId && studentId),
    refetchInterval: POLL_MS,
  })
}
export function useSendInstructorMessageMutation(courseId: string, studentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: string) => sendInstructorMessage(courseId, studentId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: instructorThreadKey(courseId, studentId) })
      qc.invalidateQueries({ queryKey: conversationsKey })
    },
  })
}
