import { httpClient } from '@/shared/api/http-client'
import type { Enrollment } from '@pilari/types'

export async function listMyEnrollments(): Promise<Enrollment[]> {
  const { data } = await httpClient.get<{ enrollments: Enrollment[] }>('/me/enrollments')
  return data.enrollments
}
