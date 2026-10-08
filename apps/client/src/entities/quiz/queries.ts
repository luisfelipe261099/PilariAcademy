import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createQuestion, getCourseGrades, getModuleQuiz, getStudentCourseGrades, listQuestions,
  releaseCourseQuizzes, removeQuestion, submitModuleQuiz, updateQuestion, type QuestionInput,
} from './api'

export const moduleQuestionsKey = (moduleId: string) => ['quiz', 'questions', moduleId] as const
export const moduleQuizKey = (moduleId: string) => ['quiz', 'student', moduleId] as const
export const courseGradesKey = (slug: string) => ['quiz', 'grades', slug] as const
export const studentGradesKey = (courseId: string, studentUid: string) => ['quiz', 'grades', 'staff', courseId, studentUid] as const

// ── instrutor ────────────────────────────────────────────────────────────────
export function useModuleQuestionsQuery(moduleId: string, enabled = true) {
  return useQuery({
    queryKey: moduleQuestionsKey(moduleId),
    queryFn: () => listQuestions(moduleId),
    enabled: enabled && Boolean(moduleId),
  })
}

export function useCreateQuestionMutation(moduleId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: QuestionInput) => createQuestion(moduleId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: moduleQuestionsKey(moduleId) }),
  })
}

export function useUpdateQuestionMutation(moduleId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<QuestionInput> }) => updateQuestion(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: moduleQuestionsKey(moduleId) }),
  })
}

export function useRemoveQuestionMutation(moduleId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => removeQuestion(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: moduleQuestionsKey(moduleId) }),
  })
}

// ── aluno ────────────────────────────────────────────────────────────────────
export function useModuleQuizQuery(moduleId: string) {
  return useQuery({
    queryKey: moduleQuizKey(moduleId),
    queryFn: () => getModuleQuiz(moduleId),
    enabled: Boolean(moduleId),
  })
}

export function useSubmitQuizMutation(moduleId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (answers: Record<string, number>) => submitModuleQuiz(moduleId, answers),
    onSuccess: () => qc.invalidateQueries({ queryKey: moduleQuizKey(moduleId) }),
  })
}

export function useCourseGradesQuery(slug: string, enabled = true) {
  return useQuery({
    queryKey: courseGradesKey(slug),
    queryFn: () => getCourseGrades(slug),
    enabled: enabled && Boolean(slug),
  })
}

// ── admin / instrutor ────────────────────────────────────────────────────────
export function useReleaseCourseQuizzesMutation(courseId: string) {
  return useMutation({
    mutationFn: (studentUid: string) => releaseCourseQuizzes(courseId, studentUid),
  })
}

export function useStudentCourseGradesQuery(courseId: string, studentUid: string, enabled = true) {
  return useQuery({
    queryKey: studentGradesKey(courseId, studentUid),
    queryFn: () => getStudentCourseGrades(courseId, studentUid),
    enabled: enabled && Boolean(courseId) && Boolean(studentUid),
  })
}
