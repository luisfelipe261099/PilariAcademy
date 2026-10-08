/// <reference types="jest" />
import { createDrizzleMock, withQueryResults, type DrizzleMock } from '../../__test-utils__/drizzle-mock'
import { allWheres } from '../../__test-utils__/sql'
import { CartService } from './cart.service'

function make(couponOver: Partial<Record<string, unknown>> = {}) {
  const db: DrizzleMock = createDrizzleMock()
  const coupons = {
    validateAndCalc: jest.fn(async () => ({ discountInCents: 2000, couponError: null, coupon: { id: '1', code: 'P20', type: 'percent', value: 20, active: true } })),
    ...couponOver,
  }
  return { db, coupons, service: new CartService(db as never, coupons as never) }
}

function courseRow(id: string, price: number) {
  return {
    course: { id, slug: id, title: id, subtitle: null, kind: 'online', priceInCents: price, coverImageUrl: null },
    category: null,
    instructorName: null,
  }
}

describe('CartService', () => {
  it('sem cupom: subtotal = soma, desconto 0, total = subtotal', async () => {
    const { db, coupons, service } = make()
    withQueryResults(db, [courseRow('a', 9700), courseRow('b', 14900)])
    const r = await service.summary('t-a', ['a', 'b'])
    expect(r.subtotalInCents).toBe(24600)
    expect(r.discountInCents).toBe(0)
    expect(r.totalInCents).toBe(24600)
    expect(coupons.validateAndCalc).not.toHaveBeenCalled()
  })

  it('com cupom: aplica desconto retornado pelo CouponsService', async () => {
    const { db, coupons, service } = make()
    withQueryResults(db, [courseRow('a', 10000)])
    const r = await service.summary('t-a', ['a'], 'P20')
    expect(r.discountInCents).toBe(2000)
    expect(r.totalInCents).toBe(8000)
    expect(r.couponCode).toBe('P20')
    expect(coupons.validateAndCalc).toHaveBeenCalledWith('t-a', 'P20', 10000, expect.any(Date))
  })

  it('a consulta de cursos filtra pelo polo', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    await service.summary('t-a', ['a'])
    const w = allWheres(db.where)[0]
    expect(w.sql).toContain('`courses`.`tenant_id` = ?')
    expect(w.params[0]).toBe('t-a')
  })
})
