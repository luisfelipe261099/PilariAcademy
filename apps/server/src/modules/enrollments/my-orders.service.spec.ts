/// <reference types="jest" />
import { createDrizzleMock, withQueryResults, type DrizzleMock } from '../../__test-utils__/drizzle-mock'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import type { SQL } from 'drizzle-orm'
import { allWheres } from '../../__test-utils__/sql'
import { MyOrdersService } from './my-orders.service'

function make() {
  const db: DrizzleMock = createDrizzleMock()
  return { db, service: new MyOrdersService(db as never) }
}

const pedido = {
  id: 'ord_1', status: 'paid', totalInCents: 79990, billingType: 'BOLETO',
  asaasInstallmentId: null, paymentMode: 'avista', settledAt: new Date('2026-09-01'),
  paymentUrl: 'https://asaas/i/1', dueDate: '2026-09-10', paidAt: new Date('2026-09-02'),
  createdAt: new Date('2026-09-01'),
}

describe('MyOrdersService', () => {
  it('filtra pelo uid do aluno — é a única coisa que separa isto do painel admin', async () => {
    const { db, service } = make()
    withQueryResults(db, [pedido], [{ orderId: 'ord_1', title: 'Curso X' }])
    await service.list('t-a', 'u1')
    // Sem este WHERE a rota devolveria a compra de qualquer aluno. O teste olha o SQL
    // renderizado, e não só "chamou where": trocar a coluna passaria por baixo.
    const q = new MySqlDialect().sqlToQuery(db.where.mock.calls[0][0] as SQL)
    expect(q.sql).toMatch(/`user_id`\s*=/)
    expect(q.params).toContain('u1')
  })

  it('sem pedidos → lista vazia e NENHUMA query extra (nada de inArray com [])', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    const r = await service.list('t-a', 'u1')
    expect(r).toEqual([])
    // `inArray(col, [])` gera SQL inválido no MySQL: o early-return existe por isso.
    expect(db.select).toHaveBeenCalledTimes(1)
  })

  it('pedido à vista NÃO ganha carneUrl', async () => {
    const { db, service } = make()
    withQueryResults(db, [pedido], [{ orderId: 'ord_1', title: 'Curso X' }])
    const [r] = await service.list('t-a', 'u1')
    expect(r.carneUrl).toBeNull()
    expect(r.installments).toEqual([])
    expect(r.courseTitles).toEqual(['Curso X'])
  })

  it('carnê ganha carneUrl SEM o prefixo /api e traz as parcelas', async () => {
    // O caminho vai para o httpClient (baseURL já tem /api) como blob autenticado.
    // Com o prefixo aqui, viraria /api/api/... e daria 404.
    const { db, service } = make()
    withQueryResults(
      db,
      [{ ...pedido, asaasInstallmentId: 'inst_1', paymentMode: 'boleto_parcelado', settledAt: null }],
      [{ orderId: 'ord_1', title: 'Curso X' }],
      [{ id: 'i1', orderId: 'ord_1', asaasChargeId: 'pay_1', installmentNumber: 1, valueInCents: 39995, status: 'paid', dueDate: '2026-09-10', paidAt: null, asaasFeeInCents: null }]
    )
    const [r] = await service.list('t-a', 'u1')
    expect(r.carneUrl).toBe('/me/orders/ord_1/carne')
    expect(r.carneUrl).not.toMatch(/^\/api/)
    expect(r.installments).toHaveLength(1)
    expect(r.settledAt).toBeNull()
  })

  it('as parcelas de TODOS os carnês saem em uma query só (o pool tem 10 conexões)', async () => {
    const { db, service } = make()
    const carne = (id: string) => ({ ...pedido, id, asaasInstallmentId: 'inst_' + id, paymentMode: 'boleto_parcelado' })
    withQueryResults(db, [carne('a'), carne('b'), carne('c')], [], [])
    await service.list('t-a', 'u1')
    // 3 selects no total: pedidos + títulos + parcelas. Nunca 1 por pedido.
    expect(db.select).toHaveBeenCalledTimes(3)
  })

  it('lista só os pedidos do aluno no polo', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    await service.list('t-a', 'u1')
    expect(allWheres(db.where)[0]).toEqual({ sql: '(`orders`.`user_id` = ? and `orders`.`tenant_id` = ?)', params: ['u1', 't-a'] })
  })
})
