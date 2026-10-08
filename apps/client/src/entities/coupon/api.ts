import { httpClient } from '@/shared/api/http-client'
import type { Coupon, CouponType } from '@pilari/types'

export interface CreateCouponInput {
  code: string
  type: CouponType
  value: number
  maxUses?: number
}

export async function listCoupons(): Promise<Coupon[]> {
  const { data } = await httpClient.get<{ coupons: Coupon[] }>('/admin/coupons')
  return data.coupons
}

export async function createCoupon(input: CreateCouponInput): Promise<Coupon> {
  const { data } = await httpClient.post<{ coupon: Coupon }>('/admin/coupons', input)
  return data.coupon
}

export async function updateCoupon(id: string, patch: { active?: boolean; value?: number }): Promise<Coupon> {
  const { data } = await httpClient.patch<{ coupon: Coupon }>(`/admin/coupons/${id}`, patch)
  return data.coupon
}

export async function deleteCoupon(id: string): Promise<void> {
  await httpClient.delete(`/admin/coupons/${id}`)
}
