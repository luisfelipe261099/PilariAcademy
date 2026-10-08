import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getClassroom, setLessonProgress } from './api'

export function useClassroomQuery(slug: string) {
  return useQuery({
    queryKey: ['classroom', slug] as const,
    queryFn: () => getClassroom(slug),
    enabled: Boolean(slug),
    retry: false,
  })
}

export function useSetProgressMutation(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ lessonId, completed }: { lessonId: string; completed: boolean }) => setLessonProgress(lessonId, completed),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['classroom', slug] })
      qc.invalidateQueries({ queryKey: ['me', 'enrollments'] })
    },
  })
}
