import type { BrandingAssetKind, MyTenantSettings, PublicTenant, TenantBrandingInput, UploadTicket } from '@pilari/types'
import { httpClient } from '@/shared/api/http-client'

export async function fetchTenant(): Promise<PublicTenant> {
  const { data } = await httpClient.get<PublicTenant>('/tenant')
  return data
}

export async function getMyTenant(): Promise<MyTenantSettings> {
  const { data } = await httpClient.get<MyTenantSettings>('/admin/tenant')
  return data
}

export async function updateMyTenant(branding: TenantBrandingInput): Promise<MyTenantSettings> {
  const { data } = await httpClient.patch<MyTenantSettings>('/admin/tenant', { branding })
  return data
}

export async function requestBrandingUpload(input: { kind: BrandingAssetKind; fileName: string; contentType: string }): Promise<UploadTicket> {
  const { data } = await httpClient.post<UploadTicket>('/admin/tenant/upload-url', input)
  return data
}
