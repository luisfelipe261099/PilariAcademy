import type {
  BrandingAssetKind, CreateTenantInput, CreateTenantResult, PlatformAuditLog, PlatformTenantDetail, PlatformTenantRow,
  ReviewQueueItem, TenantAdminResult, UpdateTenantInput, UploadTicket,
} from '@pilari/types'
import { httpClient } from '@/shared/api/http-client'

export async function listPlatformTenants(): Promise<PlatformTenantRow[]> {
  const { data } = await httpClient.get<{ tenants: PlatformTenantRow[] }>('/platform/tenants')
  return data.tenants
}
export async function getPlatformTenant(id: string): Promise<PlatformTenantDetail> {
  const { data } = await httpClient.get<PlatformTenantDetail>(`/platform/tenants/${id}`)
  return data
}
export async function createPlatformTenant(input: CreateTenantInput): Promise<CreateTenantResult> {
  const { data } = await httpClient.post<CreateTenantResult>('/platform/tenants', input)
  return data
}
/** O servidor responde 400 "Nada para alterar." a um PATCH sem campos: quem chama só monta corpo com o que mudou. */
export async function updatePlatformTenant(id: string, input: UpdateTenantInput): Promise<PlatformTenantDetail> {
  const { data } = await httpClient.patch<PlatformTenantDetail>(`/platform/tenants/${id}`, input)
  return data
}
export async function addPlatformTenantAdmin(id: string, input: { email: string; name: string }): Promise<TenantAdminResult> {
  const { data } = await httpClient.post<TenantAdminResult>(`/platform/tenants/${id}/admins`, input)
  return data
}
export async function addPlatformTenantDomain(id: string, host: string): Promise<PlatformTenantDetail> {
  const { data } = await httpClient.post<PlatformTenantDetail>(`/platform/tenants/${id}/domains`, { host })
  return data
}
export async function removePlatformTenantDomain(id: string, host: string): Promise<PlatformTenantDetail> {
  const { data } = await httpClient.delete<PlatformTenantDetail>(`/platform/tenants/${id}/domains/${encodeURIComponent(host)}`)
  return data
}
export async function requestPlatformTenantUpload(
  id: string,
  input: { kind: BrandingAssetKind; fileName: string; contentType: string }
): Promise<UploadTicket> {
  const { data } = await httpClient.post<UploadTicket>(`/platform/tenants/${id}/upload-url`, input)
  return data
}
export async function getReviewQueue(): Promise<ReviewQueueItem[]> {
  const { data } = await httpClient.get<{ items: ReviewQueueItem[] }>('/platform/review-queue')
  return data.items
}
/**
 * Aprova a versão do curso que a fila mostrou: o `fingerprint` do item vai no corpo, e o servidor responde 409
 * `COURSE_CHANGED` se o curso mudou desde que a fila foi carregada.
 */
export async function approveCourse(courseId: string, fingerprint: string): Promise<void> {
  await httpClient.post(`/platform/courses/${courseId}/approve`, { fingerprint })
}
export async function returnCourse(courseId: string, note: string): Promise<void> {
  await httpClient.post(`/platform/courses/${courseId}/return`, { note })
}
export async function takedownCourse(courseId: string, note: string): Promise<void> {
  await httpClient.post(`/platform/courses/${courseId}/takedown`, { note })
}
export async function getPlatformLogs(): Promise<PlatformAuditLog[]> {
  const { data } = await httpClient.get<{ logs: PlatformAuditLog[] }>('/platform/logs')
  return data.logs
}
