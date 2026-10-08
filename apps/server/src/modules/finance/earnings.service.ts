import { Inject, Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { courses, enrollments, orders } from '../../db/schema'
import { earnings } from '../../db/schemas/finance.schema'
import type { Database } from '../../db/types'
import { effectivePriceCents } from '../../common/lib/pricing'

/** O ganho nasce no polo do PEDIDO (order.tenantId), nunca no polo de quem aciona: webhook e reconciliação não têm polo de requisição. */
@Injectable()
export class EarningsService {
  constructor(@Inject('DB_CLIENT') private readonly db: Database) {}

  /**
   * Gera os earnings (snapshot) de um pedido pago à vista/cartão. `asaasChargeId` vazio é o
   * sentinela de "ganho do pedido inteiro" (contraste com o ganho por parcela do carnê).
   *
   * Idempotente pela UNIQUE (order_id, course_id, asaas_charge_id), não por um SELECT de
   * guarda: um SELECT por orderId desligaria a captura por parcela na primeira linha
   * gravada (parcela 1 bloquearia as parcelas 2-5). O ON DUPLICATE KEY UPDATE também
   * elimina a corrida do SELECT-depois-INSERT anterior.
   */
  async captureForOrder(orderId: string): Promise<void> {
    const orderRows = await this.db.select().from(orders).where(eq(orders.id, orderId)).limit(1)
    const order = orderRows[0]
    if (!order || order.subtotalInCents <= 0) return

    const rows = (await this.db
      .select({ course: courses })
      .from(enrollments)
      .innerJoin(courses, eq(enrollments.courseId, courses.id))
      .where(eq(enrollments.orderId, orderId))) as Array<{ course: typeof courses.$inferSelect }>

    const now = new Date()
    const totalFee = order.asaasFeeInCents ?? 0
    for (const r of rows) {
      const c = r.course
      const gross = Math.round((effectivePriceCents(c) / order.subtotalInCents) * order.totalInCents)
      // taxa do Asaas distribuída proporcional ao bruto de cada curso
      const feeShare = totalFee > 0 && order.totalInCents > 0 ? Math.round((gross / order.totalInCents) * totalFee) : 0
      const afterFee = gross - feeShare
      // parceiro recebe (100 − comissão)% do valor APÓS a taxa; a comissão fica com a plataforma
      const net = Math.round((afterFee * (100 - c.commissionPercent)) / 100)
      await this.db
        .insert(earnings)
        .values({
          id: randomUUID(), tenantId: order.tenantId, orderId, courseId: c.id, instructorId: c.instructorId,
          asaasChargeId: '',
          grossInCents: gross, asaasFeeInCents: feeShare, commissionPercent: c.commissionPercent,
          netInCents: net, createdAt: now,
        })
        .onDuplicateKeyUpdate({ set: { id: sql`id` } })
    }
  }

  /**
   * Ganho de UMA parcela do carnê. Rateia o valor daquela parcela entre os cursos do
   * pedido, com a taxa REAL daquele boleto (o Asaas cobra tarifa por boleto PAGO — um
   * carnê de 5x incorre em 5 tarifas, nunca a tarifa "do pedido"). A sobra de centavos
   * do arredondamento fica com o último curso, para a soma bater exatinho com o que entrou.
   */
  async captureForInstallment(
    orderId: string,
    chargeId: string,
    parcelaValueInCents: number,
    parcelaFeeInCents: number | null
  ): Promise<void> {
    const orderRows = await this.db.select().from(orders).where(eq(orders.id, orderId)).limit(1)
    const order = orderRows[0]
    if (!order || order.subtotalInCents <= 0 || parcelaValueInCents <= 0) return

    const rows = (await this.db
      .select({ course: courses })
      .from(enrollments)
      .innerJoin(courses, eq(enrollments.courseId, courses.id))
      .where(eq(enrollments.orderId, orderId))) as Array<{ course: typeof courses.$inferSelect }>

    const now = new Date()
    const fee = parcelaFeeInCents ?? 0
    let restanteBruto = parcelaValueInCents
    let restanteTaxa = fee

    for (let i = 0; i < rows.length; i++) {
      const c = rows[i].course
      const ultimo = i === rows.length - 1
      // O último curso absorve a sobra do arredondamento — sem isso a soma dos ganhos
      // pode ficar abaixo do que entrou (centavos evaporando).
      //
      // O peso de cada curso vem do preço AO VIVO (effectivePriceCents), enquanto
      // order.subtotalInCents ficou congelado na compra. Um carnê corre por meses: uma
      // promoção que começa/expira, ou um preço editado no meio do caminho, faz as
      // proporções dos cursos não-últimos pararem de somar 1 — e toda a divergência cairia
      // no último curso, podendo virar um ganho NEGATIVO (o painel financeiro soma os
      // earnings do instrutor; um negativo desconta do que ele já recebeu). Por isso os
      // cursos não-últimos são limitados ao que ainda resta (nunca tomam mais do que sobrou)
      // e o último nunca fica abaixo de zero — na pior hipótese perde uns centavos, nunca
      // paga um valor negativo. O fix de verdade (snapshot de preço por pedido) exige uma
      // tabela que não existe hoje; fora de escopo aqui.
      const gross = ultimo
        ? Math.max(0, restanteBruto)
        : Math.min(restanteBruto, Math.round((effectivePriceCents(c) / order.subtotalInCents) * parcelaValueInCents))
      const feeShare = ultimo ? Math.max(0, restanteTaxa) : Math.min(restanteTaxa, Math.round((gross / parcelaValueInCents) * fee))
      restanteBruto -= gross
      restanteTaxa -= feeShare
      const net = Math.round(((gross - feeShare) * (100 - c.commissionPercent)) / 100)
      await this.db
        .insert(earnings)
        .values({
          id: randomUUID(), tenantId: order.tenantId, orderId, courseId: c.id, instructorId: c.instructorId,
          asaasChargeId: chargeId,
          grossInCents: gross, asaasFeeInCents: feeShare, commissionPercent: c.commissionPercent,
          netInCents: net, createdAt: now,
        })
        .onDuplicateKeyUpdate({ set: { id: sql`id` } })
    }
  }
}
