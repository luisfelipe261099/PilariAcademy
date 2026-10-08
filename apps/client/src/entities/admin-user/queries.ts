import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminUpdateUserInput, Role } from '@pilari/types'
import {
  createUser,
  getUserDetail,
  grantEnrollment,
  listUserEnrollments,
  listUsers,
  listUsersPage,
  revokeEnrollment,
  sendPasswordReset,
  setUserRoles,
  updateUser,
  type CreateUserDto,
  type ListUsersParams,
} from './api'

const ADMIN_USERS_KEY = ['admin', 'users'] as const
const userEnrollmentsKey = (uid: string) => ['admin', 'users', uid, 'enrollments'] as const
const userDetailKey = (uid: string) => ['admin', 'users', uid, 'detail'] as const

export const adminUsersQueryOptions = queryOptions({
  queryKey: ADMIN_USERS_KEY,
  queryFn: listUsers,
})

export function useAdminUsersQuery() {
  return useQuery(adminUsersQueryOptions)
}

/** Listagem paginada + busca. `placeholderData` mantém a página anterior enquanto carrega. */
export function useAdminUsersPageQuery(params: ListUsersParams) {
  return useQuery({
    queryKey: [...ADMIN_USERS_KEY, 'list', params],
    queryFn: () => listUsersPage(params),
    placeholderData: keepPreviousData,
  })
}

export function useCreateUserMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dto: CreateUserDto) => createUser(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ADMIN_USERS_KEY }),
  })
}

export function useSetRolesMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ uid, roles }: { uid: string; roles: Role[] }) => setUserRoles(uid, roles),
    onSuccess: () => qc.invalidateQueries({ queryKey: ADMIN_USERS_KEY }),
  })
}

export function useSendPasswordResetMutation() {
  return useMutation({
    mutationFn: (uid: string) => sendPasswordReset(uid),
  })
}

export function useUserEnrollmentsQuery(uid: string | null) {
  return useQuery({
    queryKey: userEnrollmentsKey(uid ?? ''),
    queryFn: () => listUserEnrollments(uid as string),
    enabled: !!uid,
  })
}

export function useGrantEnrollmentMutation(uid: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (courseId: string) => grantEnrollment(uid, courseId),
    onSuccess: () => qc.invalidateQueries({ queryKey: userEnrollmentsKey(uid) }),
  })
}

export function useRevokeEnrollmentMutation(uid: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (courseId: string) => revokeEnrollment(uid, courseId),
    onSuccess: () => qc.invalidateQueries({ queryKey: userEnrollmentsKey(uid) }),
  })
}

export function useAdminUserDetailQuery(uid: string | undefined) {
  return useQuery({
    queryKey: userDetailKey(uid ?? ''),
    queryFn: () => getUserDetail(uid as string),
    enabled: !!uid,
  })
}

/** Ao salvar, invalida o detalhe E a listagem (o nome aparece nas duas). */
export function useUpdateUserMutation(uid: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dto: AdminUpdateUserInput) => updateUser(uid, dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: userDetailKey(uid) })
      void qc.invalidateQueries({ queryKey: ADMIN_USERS_KEY })
    },
  })
}
