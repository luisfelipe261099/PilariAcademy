/// <reference types="jest" />
import type { TenantContext } from '../tenancy/tenant-context'
import { AdminCouponsController } from './admin-coupons.controller'

const TENANT = { id: 't-a', isMatriz: false, status: 'active' } as TenantContext

function make() {
  const coupons = {
    list: jest.fn(async () => []),
    create: jest.fn(async (_tenantId: string, input: unknown) => ({ id: '1', code: (input as { code: string }).code, type: 'percent', value: 20, active: true })),
    update: jest.fn(async () => ({ id: '1', code: 'X', type: 'percent', value: 10, active: false })),
    remove: jest.fn(async () => undefined),
  }
  return { controller: new AdminCouponsController(coupons as never), coupons }
}

describe('AdminCouponsController', () => {
  it('lista cupons do polo via service', async () => {
    const { controller, coupons } = make()
    await controller.list(TENANT)
    expect(coupons.list).toHaveBeenCalledWith('t-a')
  })

  it('cria cupom via service', async () => {
    const { controller, coupons } = make()
    const res = await controller.create(TENANT, { code: 'BEMVINDO', type: 'percent', value: 20 })
    expect(coupons.create).toHaveBeenCalledWith('t-a', expect.objectContaining({ code: 'BEMVINDO' }))
    expect(res.coupon.code).toBe('BEMVINDO')
  })

  it('atualiza cupom via service', async () => {
    const { controller, coupons } = make()
    await controller.update(TENANT, '1', { active: false })
    expect(coupons.update).toHaveBeenCalledWith('t-a', '1', expect.objectContaining({ active: false }))
  })

  it('remove cupom via service', async () => {
    const { controller, coupons } = make()
    await controller.remove(TENANT, '1')
    expect(coupons.remove).toHaveBeenCalledWith('t-a', '1')
  })
})
