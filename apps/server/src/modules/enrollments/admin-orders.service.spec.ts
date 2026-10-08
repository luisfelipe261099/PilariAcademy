/// <reference types="jest" />
import { NotFoundException } from '@nestjs/common'
import { createDrizzleMock, withQueryResults, type DrizzleMock } from '../../__test-utils__/drizzle-mock'
import { allWheres } from '../../__test-utils__/sql'
import { orderInstallments } from '../../db/schema'
import { AdminOrdersService } from './admin-orders.service'

function make() {
  const db: DrizzleMock = createDrizzleMock()
  return { db, service: new AdminOrdersService(db as never) }
}

/** Pedido cru (linha do SELECT orders+users) — sobrescreva só o que o teste precisa. */
function orderRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'ord_1',
    userEmail: 'aluno@x.com',
    userName: 'Aluno',
    status: 'paid',
    totalInCents: 500000,
    billingType: 'BOLETO',
    installmentCount: 5,
    asaasChargeId: 'ch_1',
    asaasInstallmentId: null,
    paymentMode: 'avista',
    settledAt: null,
    paymentUrl: null,
    dueDate: null,
    paidAt: null,
    createdAt: null,
    ...over,
  }
}

describe('AdminOrdersService', () => {
  it('list preenche paymentMode/settledAt/installments com 1 SÓ query de order_installments para N pedidos carnê', async () => {
    // Duas carnês na mesma página (ord_1 e ord_3) + um à vista (ord_2) no meio — a prova real
    // do fix não é "1 query para 1 pedido", é "1 query para VÁRIOS pedidos carnê".
    const { db, service } = make()
    withQueryResults(
      db,
      [
        orderRow({ id: 'ord_1', asaasInstallmentId: 'inst_1', paymentMode: 'boleto_parcelado', settledAt: null }),
        orderRow({ id: 'ord_2', asaasInstallmentId: null, paymentMode: 'avista', settledAt: new Date('2026-06-01T00:00:00.000Z') }),
        orderRow({ id: 'ord_3', asaasInstallmentId: 'inst_3', paymentMode: 'boleto_parcelado', settledAt: null }),
      ], // orders + leftJoin users
      [], // títulos dos cursos (irrelevante aqui)
      [
        // 1 SÓ resultado enfileirado para order_installments, cobrindo os DOIS carnês
        { orderId: 'ord_1', installmentNumber: 1, valueInCents: 100000, status: 'paid', dueDate: '2026-01-10', paidAt: new Date('2026-01-10T00:00:00.000Z') },
        { orderId: 'ord_1', installmentNumber: 2, valueInCents: 100000, status: 'pending', dueDate: '2026-02-10', paidAt: null },
        { orderId: 'ord_3', installmentNumber: 1, valueInCents: 200000, status: 'paid', dueDate: '2026-01-15', paidAt: new Date('2026-01-15T00:00:00.000Z') },
      ]
    )

    const list = await service.list('t-a')

    // prova direta: order_installments foi consultada exatamente 1 vez, não 1 por pedido carnê
    const fromCalls = db.from.mock.calls.filter((c) => c[0] === orderInstallments).length
    expect(fromCalls).toBe(1)

    expect(list[0].paymentMode).toBe('boleto_parcelado')
    expect(list[0].settledAt).toBeNull()
    expect(list[0].installments).toEqual([
      { installmentNumber: 1, valueInCents: 100000, status: 'paid', dueDate: '2026-01-10', paidAt: '2026-01-10T00:00:00.000Z' },
      { installmentNumber: 2, valueInCents: 100000, status: 'pending', dueDate: '2026-02-10', paidAt: null },
    ])

    expect(list[1].paymentMode).toBe('avista')
    expect(list[1].settledAt).toBe('2026-06-01T00:00:00.000Z')
    expect(list[1].installments).toEqual([])

    expect(list[2].installments).toEqual([
      { installmentNumber: 1, valueInCents: 200000, status: 'paid', dueDate: '2026-01-15', paidAt: '2026-01-15T00:00:00.000Z' },
    ])
  })

  it('list não consulta order_installments quando não há nenhum pedido carnê', async () => {
    const { db, service } = make()
    withQueryResults(db, [orderRow({ id: 'ord_1', asaasInstallmentId: null })], [])
    const list = await service.list('t-a')
    expect(db.from.mock.calls.some((c) => c[0] === orderInstallments)).toBe(false)
    expect(list[0].installments).toEqual([])
  })

  it('list lê só os pedidos do polo', async () => {
    const { db, service } = make()
    withQueryResults(db, [orderRow({ id: 'ord_1' })], [])
    await service.list('t-a')
    // A 1ª consulta é a dos pedidos; as demais (títulos, parcelas) partem dos ids que ela devolveu.
    expect(allWheres(db.where)[0]).toEqual({ sql: '`orders`.`tenant_id` = ?', params: ['t-a'] })
  })

  it('list de um polo sem pedidos devolve vazio e não consulta mais nada', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    expect(await service.list('t-b')).toEqual([])
    expect(allWheres(db.where)).toEqual([{ sql: '`orders`.`tenant_id` = ?', params: ['t-b'] }])
  })

  describe('assertInTenant', () => {
    it('passa quando o pedido é do polo, e a consulta carrega o id E o polo', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ id: 'ord_1' }])
      await expect(service.assertInTenant('t-a', 'ord_1')).resolves.toBeUndefined()
      expect(allWheres(db.where)[0]).toEqual({ sql: '(`orders`.`id` = ? and `orders`.`tenant_id` = ?)', params: ['ord_1', 't-a'] })
    })

    it('pedido de outro polo responde 404, como se não existisse', async () => {
      const { db, service } = make()
      withQueryResults(db, [])
      const chamada = service.assertInTenant('t-a', 'ord_do_b')
      await expect(chamada).rejects.toBeInstanceOf(NotFoundException)
      await expect(chamada).rejects.toThrow('Pedido não encontrado.')
    })
  })
})
