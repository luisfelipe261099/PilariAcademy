import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { httpClient } from '@/shared/api/http-client'
import type { EditableProfile } from '@pilari/types'

export async function getProfile(): Promise<EditableProfile> {
  const { data } = await httpClient.get<EditableProfile>('/auth/profile')
  return data
}
export async function updateProfile(patch: Partial<EditableProfile>): Promise<EditableProfile> {
  const { data } = await httpClient.patch<EditableProfile>('/auth/profile', patch)
  return data
}

export const profileKey = ['auth', 'profile'] as const

export function useProfileQuery() {
  return useQuery({ queryKey: profileKey, queryFn: getProfile })
}
export function useUpdateProfileMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<EditableProfile>) => updateProfile(patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: profileKey })
      qc.invalidateQueries({ queryKey: ['auth', 'me'] })
    },
  })
}
