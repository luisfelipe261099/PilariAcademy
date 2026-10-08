/// <reference types="jest" />
import type { SQL } from 'drizzle-orm'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import { createDrizzleMock, withQueryResults, type DrizzleMock } from '../../__test-utils__/drizzle-mock'
import { InstallmentsService } from './installments.service'
import type { AsaasPayment } from './asaas.service'

function make() {
  const db: DrizzleMock = createDrizzleMock()
  return { db, service: new InstallmentsService(db as never) }
}

/** Pagamento mínimo do Asaas. Sobrescreva só o que o teste precisa. */
function payment(over: Partial<AsaasPayment> = {}): AsaasPayment {
  return {
    id: 'pay_1',
    status: 'PENDING',
    value: 100,
    netValue: null,
    externalReference: null,
    paymentLink: null,
    installmentCount: null,
    billingType: null,
    installment: 'inst_1',
    installmentNumber: 1,
    dueDate: '2026-09-04',
    ...over,
  }
}

describe('InstallmentsService', () => {
  describe('recordFromPayments', () => {
    it('grava uma linha por parcela, convertendo reais em centavos (arredondado, nunca truncado)', async () => {
      const { db, service } = make()
      await service.recordFromPayments('ord_1', [payment({ id: 'pay_1', value: 166.67 })])
      expect(db.values).toHaveBeenCalledTimes(1)
      const rows = db.values.mock.calls[0][0] as Record<string, unknown>[]
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ orderId: 'ord_1', asaasChargeId: 'pay_1', valueInCents: 16667, status: 'pending' })
    })

    it('pagamento já quitado no Asaas (RECEIVED) é gravado como paid', async () => {
      const { db, service } = make()
      await service.recordFromPayments('ord_1', [payment({ status: 'RECEIVED' })])
      const rows = db.values.mock.calls[0][0] as Record<string, unknown>[]
      expect(rows[0].status).toBe('paid')
    })

    it('installmentNumber nulo (parcela sem número conhecido) é preservado, não vira 0 nem quebra', async () => {
      const { db, service } = make()
      await service.recordFromPayments('ord_1', [payment({ installmentNumber: null })])
      const rows = db.values.mock.calls[0][0] as Record<string, unknown>[]
      expect(rows[0].installmentNumber).toBeNull()
    })

    it('lista vazia não gera insert nenhum', async () => {
      const { db, service } = make()
      await service.recordFromPayments('ord_1', [])
      expect(db.insert).not.toHaveBeenCalled()
    })

    it('upsert é um no-op deliberado: o ON DUPLICATE KEY UPDATE só toca a coluna id, nunca status', async () => {
      // Esta é a prova de que reexecutar a varredura NUNCA reverte uma parcela que um
      // webhook já avançou para paid/overdue/refunded: se o SET tocasse `status`, a
      // reconciliação resetaria parcelas pagas de volta para pending a cada rodada.
      const { db, service } = make()
      await service.recordFromPayments('ord_1', [payment({ status: 'RECEIVED' })])
      expect(db.onDuplicateKeyUpdate).toHaveBeenCalledTimes(1)
      const config = db.onDuplicateKeyUpdate.mock.calls[0][0] as { set: Record<string, unknown> }
      expect(Object.keys(config.set)).toEqual(['id'])
    })
  })

  describe('markStatus', () => {
    it('atualiza status pela cobrança, sem paidAt/fee quando não informados', async () => {
      const { db, service } = make()
      await service.markStatus('pay_1', 'paid')
      expect(db.update).toHaveBeenCalled()
      const patch = db.set.mock.calls[0][0] as Record<string, unknown>
      expect(patch.status).toBe('paid')
      expect('paidAt' in patch).toBe(false)
      expect('asaasFeeInCents' in patch).toBe(false)
    })

    it('inclui paidAt e feeInCents quando informados', async () => {
      const { db, service } = make()
      const paidAt = new Date('2026-09-01T00:00:00Z')
      await service.markStatus('pay_1', 'paid', { paidAt, feeInCents: 123 })
      const patch = db.set.mock.calls[0][0] as Record<string, unknown>
      const q = new MySqlDialect().sqlToQuery(patch.paidAt as SQL)
      expect(q.params).toEqual(['2026-09-01 00:00:00.000'])
      expect(patch.asaasFeeInCents).toBe(123)
    })

    it('replay do Asaas NÃO reescreve o paid_at de uma parcela que já tem data de pagamento', async () => {
      // O Asaas reentrega eventos: um PAYMENT_RECEIVED da parcela paga em setembro reenviado
      // em dezembro faria a data de pagamento no painel do admin virar dezembro. Não move
      // dinheiro, mas corrompe data financeira. A reconciliação já se protege disso de
      // propósito (paidChargeIds); o webhook não tinha guarda nenhuma.
      const { db, service } = make()
      await service.markStatus('pay_1', 'paid', { paidAt: new Date('2026-12-25T00:00:00Z') })
      const patch = db.set.mock.calls[0][0] as Record<string, unknown>
      const { sql: text } = new MySqlDialect().sqlToQuery(patch.paidAt as SQL)
      // a data já gravada ganha da que chega agora
      expect(text.replace(/\s+/g, ' ').toLowerCase()).toBe('coalesce(`order_installments`.`paid_at`, ?)')
    })

    it('devolve false quando o UPDATE não achou parcela nenhuma', async () => {
      // Cobrança que o checkout não gravou (ou que o Asaas reemitiu com outro id): o webhook
      // precisa saber, senão captura o ganho de uma parcela que nunca vira `paid` e o carnê
      // nunca quita — sem uma linha de log.
      const { db, service } = make()
      withQueryResults(db, [{ affectedRows: 0 }])
      await expect(service.markStatus('pay_fantasma', 'paid')).resolves.toBe(false)
    })

    it('devolve true quando alguma linha foi afetada', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ affectedRows: 1 }])
      await expect(service.markStatus('pay_1', 'paid')).resolves.toBe(true)
    })

    it('driver que não informa affectedRows conta como sucesso ("não sei" ≠ "sumiu")', async () => {
      const { service } = make()
      await expect(service.markStatus('pay_1', 'paid')).resolves.toBe(true)
    })

    it('feeInCents nulo NÃO sobrescreve o valor já gravado', async () => {
      const { db, service } = make()
      await service.markStatus('pay_1', 'refunded', { feeInCents: null })
      const patch = db.set.mock.calls[0][0] as Record<string, unknown>
      expect('asaasFeeInCents' in patch).toBe(false)
    })
  })

  describe('findOrderIdByCharge', () => {
    it('retorna o orderId da parcela encontrada', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ orderId: 'ord_1' }])
      await expect(service.findOrderIdByCharge('pay_2')).resolves.toBe('ord_1')
    })

    it('retorna null quando a cobrança não pertence a nenhuma parcela conhecida', async () => {
      const { db, service } = make()
      withQueryResults(db, [])
      await expect(service.findOrderIdByCharge('pay_desconhecido')).resolves.toBeNull()
    })
  })

  describe('isSettled', () => {
    it('sem parcelas esperadas → false, sem nem consultar o banco', async () => {
      const { db, service } = make()
      await expect(service.isSettled('ord_1', 0)).resolves.toBe(false)
      expect(db.select).not.toHaveBeenCalled()
    })

    it('total pago alcança o esperado → true', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ n: 3 }])
      await expect(service.isSettled('ord_1', 3)).resolves.toBe(true)
    })

    it('ainda faltam parcelas pagas → false', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ n: 2 }])
      await expect(service.isSettled('ord_1', 3)).resolves.toBe(false)
    })
  })

  describe('paidChargeIds', () => {
    it('devolve o conjunto de cobranças já marcadas paid do pedido', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ chargeId: 'pay_1' }, { chargeId: 'pay_2' }])
      const set = await service.paidChargeIds('ord_1')
      expect(set).toEqual(new Set(['pay_1', 'pay_2']))
    })

    it('pedido sem parcela paga → conjunto vazio', async () => {
      const { db, service } = make()
      withQueryResults(db, [])
      const set = await service.paidChargeIds('ord_1')
      expect(set.size).toBe(0)
    })
  })

  describe('listForOrder', () => {
    it('mapeia as linhas para OrderInstallment, convertendo paidAt para ISO string e preservando installmentNumber nulo', async () => {
      const { db, service } = make()
      const paidAt = new Date('2026-09-01T12:00:00Z')
      withQueryResults(db, [
        { installmentNumber: 1, valueInCents: 10000, status: 'paid', dueDate: '2026-09-01', paidAt },
        { installmentNumber: null, valueInCents: 10000, status: 'pending', dueDate: null, paidAt: null },
      ])
      const list = await service.listForOrder('ord_1')
      expect(list[0]).toEqual({ installmentNumber: 1, valueInCents: 10000, status: 'paid', dueDate: '2026-09-01', paidAt: paidAt.toISOString() })
      expect(list[1]).toEqual({ installmentNumber: null, valueInCents: 10000, status: 'pending', dueDate: null, paidAt: null })
    })
  })
})
