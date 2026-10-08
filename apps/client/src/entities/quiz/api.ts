import { httpClient } from '@/shared/api/http-client'
import type { AuthoringQuestion, CourseGrades, QuizForStudent, QuizResult } from '@pilari/types'

export interface QuestionInput {
  prompt: string
  options: string[]
  correctIndex: number
  points?: number
}

// ── instrutor ────────────────────────────────────────────────────────────────
export async function listQuestions(moduleId: string): Promise<AuthoringQuestion[]> {
  const { data } = await httpClient.get<{ questions: AuthoringQuestion[] }>(`/instructor/modules/${moduleId}/questions`)
  return data.questions
}
export async function createQuestion(moduleId: string, input: QuestionInput): Promise<{ id: string }> {
  const { data } = await httpClient.post<{ id: string }>(`/instructor/modules/${moduleId}/questions`, input)
  return data
}
export async function updateQuestion(questionId: string, patch: Partial<QuestionInput>): Promise<void> {
  await httpClient.patch(`/instructor/questions/${questionId}`, patch)
}
export async function removeQuestion(questionId: string): Promise<void> {
  await httpClient.delete(`/instructor/questions/${questionId}`)
}

// ── aluno ────────────────────────────────────────────────────────────────────
export async function getModuleQuiz(moduleId: string): Promise<QuizForStudent> {
  const { data } = await httpClient.get<QuizForStudent>(`/me/modules/${moduleId}/quiz`)
  return data
}
export async function submitModuleQuiz(moduleId: string, answers: Record<string, number>): Promise<QuizResult> {
  const { data } = await httpClient.post<QuizResult>(`/me/modules/${moduleId}/quiz/submit`, { answers })
  return data
}
export async function getCourseGrades(slug: string): Promise<CourseGrades> {
  const { data } = await httpClient.get<CourseGrades>(`/me/courses/${slug}/grades`)
  return data
}

// ── admin / instrutor ────────────────────────────────────────────────────────
export async function releaseCourseQuizzes(courseId: string, studentUid: string): Promise<void> {
  await httpClient.post(`/instructor/courses/${courseId}/students/${studentUid}/quiz-release`)
}
export async function getStudentCourseGrades(courseId: string, studentUid: string): Promise<CourseGrades> {
  const { data } = await httpClient.get<CourseGrades>(`/instructor/courses/${courseId}/students/${studentUid}/grades`)
  return data
}
