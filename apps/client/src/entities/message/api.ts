import { httpClient } from '@/shared/api/http-client'
import type { ConversationSummary, Message, MessageThread } from '@pilari/types'

// ── aluno ────────────────────────────────────────────────────────────────────
export async function getStudentThread(slug: string): Promise<MessageThread> {
  const { data } = await httpClient.get<MessageThread>(`/me/courses/${slug}/messages`)
  return data
}
export async function sendStudentMessage(slug: string, body: string): Promise<Message> {
  const { data } = await httpClient.post<{ message: Message }>(`/me/courses/${slug}/messages`, { body })
  return data.message
}

// ── instrutor ────────────────────────────────────────────────────────────────
export async function getConversations(): Promise<ConversationSummary[]> {
  const { data } = await httpClient.get<{ conversations: ConversationSummary[] }>('/instructor/conversations')
  return data.conversations
}
export async function getInstructorThread(courseId: string, studentId: string): Promise<MessageThread> {
  const { data } = await httpClient.get<MessageThread>(`/instructor/courses/${courseId}/students/${studentId}/messages`)
  return data
}
export async function sendInstructorMessage(courseId: string, studentId: string, body: string): Promise<Message> {
  const { data } = await httpClient.post<{ message: Message }>(`/instructor/courses/${courseId}/students/${studentId}/messages`, { body })
  return data.message
}
