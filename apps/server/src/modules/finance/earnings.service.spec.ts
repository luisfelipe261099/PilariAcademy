/// <reference types="jest" />
import { createDrizzleMock, withQueryResults, type DrizzleMock } from '../../__test-utils__/drizzle-mock'
import { EarningsService } from './earnings.service'

function make() {
  const db: DrizzleMock = createDrizzleMock()
  return { db, service: new EarningsService(db as never) }
}

describe('EarningsService', () => {
  describe('captureForOrder', () => {
    it('rateia e calcula net com comissão', async () => {
      const { db, service } = make()
      withQueryResults(
        db,
        [{ id: 'o1', tenantId: 't-a', subtotalInCents: 20000, totalInCents: 16000 }], // order
        [{ course: { id: 'c1', priceInCents: 10000, commissionPercent: 30, instructorId: 'i1' } }] // cursos do pedido
      )
      await service.captureForOrder('o1')
      const valuesArg = (db.values.mock.calls as unknown as unknown[][])[0][0] as { grossInCents: number; netInCents: number }
      expect(valuesArg.grossInCents).toBe(8000) // 10000/20000 * 16000
      expect(valuesArg.netInCents).toBe(5600) // 8000 * 70%
      // O ganho nasce no polo do PEDIDO, nunca num polo fixo.
      expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-a' }))
    })

    it('todo ganho do pedido nasce no polo do pedido, de qualquer curso', async () => {
      const { db, service } = make()
      withQueryResults(
        db,
        [{ id: 'o9', tenantId: 't-b', subtotalInCents: 20000, totalInCents: 20000 }],
        [
          { course: { id: 'c1', priceInCents: 10000, commissionPercent: 30, instructorId: 'i1' } },
          { course: { id: 'c2', priceInCents: 10000, commissionPercent: 30, instructorId: 'i2' } },
        ]
      )
      await service.captureForOrder('o9')
      const polos = (db.values.mock.calls as unknown as unknown[][]).map((c) => (c[0] as { tenantId: string }).tenantId)
      expect(polos).toEqual(['t-b', 't-b'])
    })

    it('desconta a taxa do Asaas antes do split', async () => {
      const { db, service } = make()
      withQueryResults(
        db,
        [{ id: 'o1', subtotalInCents: 10000, totalInCents: 10000, asaasFeeInCents: 200 }], // pedido c/ taxa R$2,00
        [{ course: { id: 'c1', priceInCents: 10000, commissionPercent: 50, instructorId: 'i1' } }] // 1 curso, comissão 50%
      )
      await service.captureForOrder('o1')
      const v = (db.values.mock.calls as unknown as unknown[][])[0][0] as { grossInCents: number; asaasFeeInCents: number; netInCents: number }
      expect(v.grossInCents).toBe(10000)
      expect(v.asaasFeeInCents).toBe(200) // taxa inteira alocada ao único curso
      expect(v.netInCents).toBe(4900) // (10000 − 200) × 50% = 4900
    })

    it('grava com asaasChargeId vazio — sentinela de "ganho do pedido inteiro"', async () => {
      const { db, service } = make()
      withQueryResults(
        db,
        [{ id: 'o2', subtotalInCents: 10000, totalInCents: 10000 }],
        [{ course: { id: 'c1', priceInCents: 10000, commissionPercent: 30, instructorId: 'i1' } }]
      )
      await service.captureForOrder('o2')
      const v = (db.values.mock.calls as unknown as unknown[][])[0][0] as { asaasChargeId: string }
      expect(v.asaasChargeId).toBe('')
    })

    it('idempotência é via ON DUPLICATE KEY UPDATE (UNIQUE order+course+charge), não mais um SELECT de guarda por pedido', async () => {
      // A guarda antiga era `SELECT … WHERE order_id = ? LIMIT 1`, um SELECT a mais antes
      // do order/cursos. Ela sumiu: agora só há 2 SELECTs (order, cursos) e a proteção
      // contra duplicata é o ON DUPLICATE KEY UPDATE apoiado na UNIQUE nova — a mesma
      // técnica já usada em InstallmentsService.recordFromPayments.
      const { db, service } = make()
      withQueryResults(
        db,
        [{ id: 'o1', subtotalInCents: 10000, totalInCents: 10000 }],
        [{ course: { id: 'c1', priceInCents: 10000, commissionPercent: 30, instructorId: 'i1' } }]
      )
      await service.captureForOrder('o1')
      expect(db.select).toHaveBeenCalledTimes(2)
      expect(db.onDuplicateKeyUpdate).toHaveBeenCalledTimes(1)
      const config = db.onDuplicateKeyUpdate.mock.calls[0][0] as { set: Record<string, unknown> }
      expect(Object.keys(config.set)).toEqual(['id'])
    })

    it('reexecutar para o mesmo pedido tenta inserir de novo — sem guarda em app, quem protege é a UNIQUE', async () => {
      // Prova a propriedade que importa: reexecutar captureForOrder NÃO é bloqueado por um
      // SELECT de guarda em memória (isso quebraria a captura por parcela). O app sempre
      // tenta o INSERT; no MySQL real, a UNIQUE (order_id, course_id, asaas_charge_id) faz
      // a segunda tentativa virar um no-op (SET id = id), nunca uma segunda linha.
      const { db, service } = make()
      withQueryResults(
        db,
        [{ id: 'o1', subtotalInCents: 10000, totalInCents: 10000 }],
        [{ course: { id: 'c1', priceInCents: 10000, commissionPercent: 30, instructorId: 'i1' } }]
      )
      await service.captureForOrder('o1')
      withQueryResults(
        db,
        [{ id: 'o1', subtotalInCents: 10000, totalInCents: 10000 }],
        [{ course: { id: 'c1', priceInCents: 10000, commissionPercent: 30, instructorId: 'i1' } }]
      )
      await service.captureForOrder('o1')
      expect(db.insert).toHaveBeenCalledTimes(2)
      expect(db.onDuplicateKeyUpdate).toHaveBeenCalledTimes(2)
    })
  })

  describe('captureForInstallment', () => {
    it('rateia o valor da PARCELA, não o do pedido', async () => {
      // Pedido de R$ 500 em 5x. A parcela vale R$ 100; o ganho tem que ser sobre R$ 100.
      const { db, service } = make()
      withQueryResults(
        db,
        [{ id: 'ord_1', subtotalInCents: 50000 }], // order
        [{ course: { id: 'c1', priceInCents: 50000, commissionPercent: 30, instructorId: 'i1' } }] // cursos do pedido
      )
      await service.captureForInstallment('ord_1', 'pay_1', 10000, 199)
      const v = (db.values.mock.calls as unknown as unknown[][])[0][0] as {
        orderId: string
        asaasChargeId: string
        grossInCents: number
        asaasFeeInCents: number
        netInCents: number
      }
      expect(v).toEqual(
        expect.objectContaining({ orderId: 'ord_1', asaasChargeId: 'pay_1', grossInCents: 10000, asaasFeeInCents: 199 })
      )
      // net = (10000 − 199) × 70% = 6861 (arredondado)
      expect(v.netInCents).toBe(6861)
    })

    it('todo ganho da parcela nasce no polo do pedido', async () => {
      const { db, service } = make()
      withQueryResults(
        db,
        [{ id: 'ord_7', tenantId: 't-a', subtotalInCents: 20000 }],
        [
          { course: { id: 'c1', priceInCents: 10000, commissionPercent: 30, instructorId: 'i1' } },
          { course: { id: 'c2', priceInCents: 10000, commissionPercent: 30, instructorId: 'i2' } },
        ]
      )
      await service.captureForInstallment('ord_7', 'pay_7', 10000, 100)
      const polos = (db.values.mock.calls as unknown as unknown[][]).map((c) => (c[0] as { tenantId: string }).tenantId)
      expect(polos).toEqual(['t-a', 't-a'])
    })

    it('usa a taxa da PARCELA, não a do pedido', async () => {
      // O Asaas cobra tarifa POR BOLETO PAGO: num carnê de 5x são 5 tarifas. Usar a taxa do
      // pedido (aqui, 199) subestimaria o custo e infla o ganho do instrutor — a taxa certa
      // é a do argumento (250), da PARCELA que efetivamente pagou.
      const { db, service } = make()
      withQueryResults(
        db,
        [{ id: 'ord_1', subtotalInCents: 50000, asaasFeeInCents: 199 }], // taxa do PEDIDO (não deve ser usada)
        [{ course: { id: 'c1', priceInCents: 50000, commissionPercent: 0, instructorId: 'i1' } }]
      )
      await service.captureForInstallment('ord_1', 'pay_2', 10000, 250)
      const v = (db.values.mock.calls as unknown as unknown[][])[0][0] as { asaasFeeInCents: number }
      expect(v.asaasFeeInCents).toBe(250)
    })

    it('a soma do bruto por curso bate exatinho com o valor da parcela — a sobra do arredondamento vai pro último curso', async () => {
      // 3 cursos de R$100 cada (subtotal R$300). Uma parcela de R$100 rateia em 33,33 por
      // curso — sem tratamento, 3×33 = 99 e um centavo evapora. O último curso deve absorver
      // a sobra para a soma fechar em 100 (10000 centavos) exatamente.
      const { db, service } = make()
      withQueryResults(
        db,
        [{ id: 'ord_3', subtotalInCents: 30000 }],
        [
          { course: { id: 'c1', priceInCents: 10000, commissionPercent: 0, instructorId: 'i1' } },
          { course: { id: 'c2', priceInCents: 10000, commissionPercent: 0, instructorId: 'i2' } },
          { course: { id: 'c3', priceInCents: 10000, commissionPercent: 0, instructorId: 'i3' } },
        ]
      )
      await service.captureForInstallment('ord_3', 'pay_3', 10000, null)
      expect(db.insert).toHaveBeenCalledTimes(3)
      const rows = (db.values.mock.calls as unknown as unknown[][]).map((c) => c[0] as { grossInCents: number })
      const sum = rows.reduce((acc, r) => acc + r.grossInCents, 0)
      expect(sum).toBe(10000)
      expect(rows[0].grossInCents).toBe(3333)
      expect(rows[1].grossInCents).toBe(3333)
      expect(rows[2].grossInCents).toBe(3334) // sobra do arredondamento
    })

    it('rateia também a taxa por curso — proporcional ao bruto de cada um, restante no último', async () => {
      // 3 cursos: R$100/R$200/R$50 (subtotal R$350 = 35000). Parcela de R$100 (10000), taxa
      // R$1,99 (199). Números derivados à mão (bate com o teste antes de escrever a asserção):
      //   c1: gross = round((10000/35000)×10000) = round(2857,14…) = 2857
      //       feeShare = round((2857/10000)×199) = round(56,85…) = 57
      //   c2: gross = round((20000/35000)×10000) = round(5714,28…) = 5714
      //       feeShare = round((5714/10000)×199) = round(113,70…) = 114
      //   c3 (último): gross = 10000 − 2857 − 5714 = 1429; feeShare = 199 − 57 − 114 = 28
      // Antes desta task, só havia teste de taxa com 1 curso só — nesse caso o loop nunca
      // passa pelo ramo "não-último" de feeShare (Math.round((gross/parcelaValueInCents)*fee)),
      // que é onde um erro na taxa por curso passaria batido.
      const { db, service } = make()
      withQueryResults(
        db,
        [{ id: 'ord_4', subtotalInCents: 35000 }],
        [
          { course: { id: 'c1', priceInCents: 10000, commissionPercent: 0, instructorId: 'i1' } },
          { course: { id: 'c2', priceInCents: 20000, commissionPercent: 0, instructorId: 'i2' } },
          { course: { id: 'c3', priceInCents: 5000, commissionPercent: 0, instructorId: 'i3' } },
        ]
      )
      await service.captureForInstallment('ord_4', 'pay_4', 10000, 199)
      const rows = (db.values.mock.calls as unknown as unknown[][]).map(
        (c) => c[0] as { grossInCents: number; asaasFeeInCents: number }
      )
      expect(rows.map((r) => r.grossInCents)).toEqual([2857, 5714, 1429])
      expect(rows.map((r) => r.asaasFeeInCents)).toEqual([57, 114, 28])
      expect(rows.reduce((acc, r) => acc + r.grossInCents, 0)).toBe(10000)
      expect(rows.reduce((acc, r) => acc + r.asaasFeeInCents, 0)).toBe(199)
    })

    it('preço editado ao vivo depois da compra não gera ganho negativo — o rateio é limitado ao que ainda resta na parcela', async () => {
      // 2 cursos de R$100 cada na compra (subtotal CONGELADO em 20000, o valor de quando o
      // pedido foi pago). Um carnê corre por meses; o curso 1 tem o preço AO VIVO reajustado
      // para R$300 (30000) antes de uma parcela seguinte ser capturada. Sem o clamp, c1
      // tomaria round((30000/20000)×10000) = 15000 — mais que a parcela inteira (10000) — e
      // o último curso fecharia em 10000 − 15000 = −5000, um ganho NEGATIVO que o painel
      // financeiro desconta do que o instrutor já recebeu. Com o clamp, c1 é limitado ao que
      // resta (10000, a parcela inteira) e o último fecha em 0 — nunca negativo.
      const { db, service } = make()
      withQueryResults(
        db,
        [{ id: 'ord_5', subtotalInCents: 20000 }], // subtotal congelado na compra
        [
          { course: { id: 'c1', priceInCents: 30000, commissionPercent: 0, instructorId: 'i1' } }, // preço ao vivo já subiu
          { course: { id: 'c2', priceInCents: 10000, commissionPercent: 0, instructorId: 'i2' } },
        ]
      )
      await service.captureForInstallment('ord_5', 'pay_5', 10000, null)
      const rows = (db.values.mock.calls as unknown as unknown[][]).map((c) => c[0] as { grossInCents: number })
      expect(rows[0].grossInCents).toBe(10000) // limitado ao que resta, não aos 15000 "proporcionais"
      expect(rows[1].grossInCents).toBe(0) // último curso: nunca negativo
    })

    it('grava o asaasChargeId da PARCELA (não vazio)', async () => {
      const { db, service } = make()
      withQueryResults(
        db,
        [{ id: 'ord_1', subtotalInCents: 50000 }],
        [{ course: { id: 'c1', priceInCents: 50000, commissionPercent: 30, instructorId: 'i1' } }]
      )
      await service.captureForInstallment('ord_1', 'pay_1', 10000, 199)
      const v = (db.values.mock.calls as unknown as unknown[][])[0][0] as { asaasChargeId: string }
      expect(v.asaasChargeId).toBe('pay_1')
    })

    it('repetir a mesma parcela (replay de webhook) tenta inserir de novo via ON DUPLICATE KEY UPDATE — quem impede duplicar é a UNIQUE por charge', async () => {
      const { db, service } = make()
      withQueryResults(
        db,
        [{ id: 'ord_1', subtotalInCents: 50000 }],
        [{ course: { id: 'c1', priceInCents: 50000, commissionPercent: 30, instructorId: 'i1' } }]
      )
      await service.captureForInstallment('ord_1', 'pay_1', 10000, 199)
      withQueryResults(
        db,
        [{ id: 'ord_1', subtotalInCents: 50000 }],
        [{ course: { id: 'c1', priceInCents: 50000, commissionPercent: 30, instructorId: 'i1' } }]
      )
      await service.captureForInstallment('ord_1', 'pay_1', 10000, 199) // replay do mesmo webhook
      expect(db.insert).toHaveBeenCalledTimes(2)
      expect(db.onDuplicateKeyUpdate).toHaveBeenCalledTimes(2)
      const config = db.onDuplicateKeyUpdate.mock.calls[1][0] as { set: Record<string, unknown> }
      expect(Object.keys(config.set)).toEqual(['id'])
    })
  })
})
