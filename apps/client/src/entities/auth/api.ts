import { httpClient } from '@/shared/api/http-client'
import type { AuthUser, Role } from '@pilari/types'

export interface AuthSyncResponse {
  user: AuthUser | null
  roles: Role[]
}

export async function syncUserData(body?: {
  displayName?: string
  photoUrl?: string
}): Promise<AuthSyncResponse> {
  const { data } = await httpClient.post<AuthSyncResponse>('/auth/sync-user-data', body ?? {})
  return data
}

export async function fetchMe(): Promise<AuthSyncResponse> {
  const { data } = await httpClient.get<AuthSyncResponse>('/auth/me')
  return data
}
