import { httpClient } from '@/shared/api/http-client'
import type { AdminEnrollment, AdminUpdateUserInput, AdminUserDetail, AuthUser, Role } from '@pilari/types'

export interface CreateUserDto {
  email: string
  displayName: string
  password: string
  roles: Role[]
}

export async function listUsers(): Promise<AuthUser[]> {
  const { data } = await httpClient.get<{ users: AuthUser[] }>('/admin/users')
  return data.users
}

export interface ListUsersParams {
  page: number
  pageSize: number
  q?: string
}

export interface ListUsersPage {
  users: AuthUser[]
  total: number
}

/** Versão paginada + busca da listagem (usada só pela tela de usuários do admin). */
export async function listUsersPage(params: ListUsersParams): Promise<ListUsersPage> {
  const { data } = await httpClient.get<ListUsersPage>('/admin/users', {
    params: {
      page: params.page,
      pageSize: params.pageSize,
      ...(params.q ? { q: params.q } : {}),
    },
  })
  return data
}

export interface CreateUserResult {
  user: AuthUser
  /** true quando o e-mail já tinha conta na rede: a pessoa só ganhou os papéis neste polo e a senha digitada não foi usada. */
  existingAccount: boolean
}

export async function createUser(dto: CreateUserDto): Promise<CreateUserResult> {
  const { data } = await httpClient.post<CreateUserResult>('/admin/users', dto)
  return data
}

export async function setUserRoles(uid: string, roles: Role[]): Promise<AuthUser> {
  const { data } = await httpClient.patch<{ user: AuthUser }>(`/admin/users/${uid}/roles`, { roles })
  return data.user
}

/** Dispara o e-mail de redefinição de senha ao titular (o admin não escolhe a senha). */
export async function sendPasswordReset(uid: string): Promise<void> {
  await httpClient.post(`/admin/users/${uid}/password-reset`)
}

export async function listUserEnrollments(uid: string): Promise<AdminEnrollment[]> {
  const { data } = await httpClient.get<{ enrollments: AdminEnrollment[] }>(`/admin/users/${uid}/enrollments`)
  return data.enrollments
}

export async function grantEnrollment(uid: string, courseId: string): Promise<AdminEnrollment> {
  const { data } = await httpClient.post<{ enrollment: AdminEnrollment }>(`/admin/users/${uid}/enrollments`, { courseId })
  return data.enrollment
}

export async function revokeEnrollment(uid: string, courseId: string): Promise<void> {
  await httpClient.delete(`/admin/users/${uid}/enrollments/${courseId}`)
}

/** Perfil completo (com CPF e status) para a tela de detalhe do aluno. */
export async function getUserDetail(uid: string): Promise<AdminUserDetail> {
  const { data } = await httpClient.get<{ user: AdminUserDetail }>(`/admin/users/${uid}`)
  return data.user
}

/** Edita nome e/ou CPF do aluno. Só os campos enviados são gravados. */
export async function updateUser(uid: string, dto: AdminUpdateUserInput): Promise<AdminUserDetail> {
  const { data } = await httpClient.patch<{ user: AdminUserDetail }>(`/admin/users/${uid}`, dto)
  return data.user
}
