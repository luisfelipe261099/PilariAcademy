/// <reference types="jest" />
import { ConflictException, NotFoundException } from '@nestjs/common'
import { createDrizzleMock, withQueryResults, type DrizzleMock } from '../../__test-utils__/drizzle-mock'
import { allWheres } from '../../__test-utils__/sql'
import { CouponsService } from './coupons.service'

function make() {
  const db: DrizzleMock = createDrizzleMock()
  return { db, service: new CouponsService(db as never) }
}

const now = new Date('2026-06-25T12:00:00Z')

describe('CouponsService', () => {
  it('create gera id e insere o cupom', async () => {
    const { db, service } = make()
    withQueryResults(db, undefined, [{ id: 'x', code: 'BEMVINDO', type: 'percent', value: 20, active: true }])
    const c = await service.create('t-a', { code: 'BEMVINDO', type: 'percent', value: 20 })
    expect(db.insert).toHaveBeenCalled()
    expect(c.code).toBe('BEMVINDO')
  })

  it('validateAndCalc: código inexistente → couponError, desconto 0', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    const r = await service.validateAndCalc('t-a', 'NOPE', 10000, now)
    expect(r.discountInCents).toBe(0)
    expect(r.couponError).toBeTruthy()
  })

  it('validateAndCalc: percent 20% de 10000 → 2000', async () => {
    const { db, service } = make()
    withQueryResults(db, [{ id: '1', code: 'P20', type: 'percent', value: 20, active: true, validUntil: null, maxUses: null, usedCount: 0 }])
    const r = await service.validateAndCalc('t-a', 'P20', 10000, now)
    expect(r.discountInCents).toBe(2000)
    expect(r.couponError).toBeNull()
  })

  it('validateAndCalc: fixed limitado ao subtotal', async () => {
    const { db, service } = make()
    withQueryResults(db, [{ id: '2', code: 'F50', type: 'fixed', value: 5000, active: true, validUntil: null, maxUses: null, usedCount: 0 }])
    const r = await service.validateAndCalc('t-a', 'F50', 3000, now)
    expect(r.discountInCents).toBe(3000)
  })

  it('validateAndCalc procura o código só no polo', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    const r = await service.validateAndCalc('t-a', 'bemvindo', 10000, new Date())
    expect(r.couponError).toBe('Cupom inválido.')
    expect(allWheres(db.where)[0].params).toEqual(['t-a', 'BEMVINDO'])
  })

  it('reserveUse e alreadyRedeemed filtram pelo polo', async () => {
    const { db, service } = make()
    withQueryResults(db, [{ affectedRows: 1 }], [])
    await service.reserveUse('t-a', 'bemvindo')
    await service.alreadyRedeemed('t-a', 'bemvindo', 'u1')
    const [reserva, resgate] = allWheres(db.where)
    expect(reserva.sql).toContain('`coupons`.`tenant_id` = ?')
    expect(reserva.params.slice(0, 2)).toEqual(['t-a', 'BEMVINDO'])
    expect(resgate.sql).toContain('`coupon_redemptions`.`tenant_id` = ?')
  })

  it('código repetido no mesmo polo responde 409', async () => {
    const { db, service } = make()
    db.values.mockImplementationOnce(() => {
      throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY', errno: 1062 })
    })
    await expect(service.create('t-a', { code: 'X', type: 'percent', value: 10 })).rejects.toThrow(ConflictException)
  })

  it('update e remove de cupom de outro polo respondem 404', async () => {
    const { db, service } = make()
    withQueryResults(db, [], [])
    await expect(service.update('t-a', 'cp-b', { active: false })).rejects.toThrow(NotFoundException)
    await expect(service.remove('t-a', 'cp-b')).rejects.toThrow(NotFoundException)
  })
})
