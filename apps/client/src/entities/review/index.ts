import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { httpClient } from '@/shared/api/http-client'
import type { CourseReview, CourseReviews } from '@pilari/types'

export async function getMyReviews(slug: string): Promise<CourseReviews> {
  const { data } = await httpClient.get<CourseReviews>(`/me/courses/${slug}/reviews`)
  return data
}
export async function upsertReview(slug: string, rating: number, comment: string | null): Promise<CourseReview> {
  const { data } = await httpClient.put<{ review: CourseReview }>(`/me/courses/${slug}/reviews`, { rating, comment })
  return data.review
}

export const reviewsKey = (slug: string) => ['reviews', slug] as const

export function useCourseReviewsQuery(slug: string, enabled = true) {
  return useQuery({ queryKey: reviewsKey(slug), queryFn: () => getMyReviews(slug), enabled: enabled && Boolean(slug), retry: false })
}
export function useUpsertReviewMutation(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ rating, comment }: { rating: number; comment: string | null }) => upsertReview(slug, rating, comment),
    onSuccess: () => qc.invalidateQueries({ queryKey: reviewsKey(slug) }),
  })
}
