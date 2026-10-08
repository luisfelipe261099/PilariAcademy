import { Inject, Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import type { InstallmentStatus, OrderInstallment } from '@pilari/types'
import { orderInstallments } from '../../db/schema'
import type { Database } from '../../db/types'
import type { AsaasPayment } from './asaas.service'
import { PAID_STATUSES } from './payment-status'

/**
 * Linha crua de `order_installments` → formato exposto ao aluno/admin. Extraída da classe
 * (função pura, sem `this.db`) porque quem lista parcelas de VÁRIOS pedidos de uma vez
 * (admin-orders.service.ts, para não fazer 1 query por pedido) precisa da MESMA forma que
 * `listForOrder` produz, sem duplicar a lógica de mapeamento em dois lugares.
 */
export function toOrderInstallment(r: typeof orderInstallments.$inferSelect): OrderInstallment {
  return {
    installmentNumber: r.installmentNumber,
    valueInCents: r.valueInCents,
    status: r.status,
    dueDate: r.dueDate,
    paidAt: r.paidAt ? r.paidAt.toISOString() : null,
  }
}

/**
 * Dono da tabela `order_installments`. Fica fora do WebhookService de propósito: as parcelas
 * são consumidas por checkout, webhook, reconciliação, certificado e admin — juntar tudo em
 * webhook.service.ts (que já acumula cinco responsabilidades) tornaria o arquivo ilegível.
 */
@Injectable()
export class InstallmentsService {
  constructor(@Inject('DB_CLIENT') private readonly db: Database) {}

  /**
   * Grava as parcelas de um pedido (todas de uma vez, no checkout). Idempotente pelo UNIQUE
   * em `asaasChargeId`: `ON DUPLICATE KEY UPDATE id = id` é um no-op deliberado — reexecutar
   * esta varredura (ex.: reconciliação) NUNCA pode sobrescrever um status que um webhook já
   * avançou para paid/overdue/refunded. Se o SET tocasse `status`, a reconciliação resetaria
   * parcelas pagas de volta para pending a cada rodada e o carnê nunca quitaria.
   */
  async recordFromPayments(orderId: string, payments: AsaasPayment[]): Promise<void> {
    if (!payments.length) return
    const now = new Date()
    const values = payments.map((p) => ({
      id: randomUUID(),
      orderId,
      asaasChargeId: p.id,
      // Nullable de propósito: existem parcelas cujo número o Asaas não informa.
      installmentNumber: p.installmentNumber,
      // Asaas manda reais (float); a tabela guarda centavos inteiros. Math.round, nunca
      // truncar — truncar um valor como 166.67 perderia 1 centavo sistematicamente.
      valueInCents: Math.round((p.value ?? 0) * 100),
      status: (PAID_STATUSES.has(p.status) ? 'paid' : 'pending') as InstallmentStatus,
      dueDate: p.dueDate,
      createdAt: now,
      updatedAt: now,
    }))
    await this.db.insert(orderInstallments).values(values).onDuplicateKeyUpdate({ set: { id: sql`id` } })
  }

  /**
   * Atualiza o status de UMA parcela pela cobrança (usado pelo webhook e pela baixa manual).
   *
   * Devolve `false` quando o UPDATE não achou linha nenhuma — a parcela não existe (o checkout
   * não a gravou, ou o Asaas reemitiu a cobrança com outro id). Isso PRECISA ser visível: o
   * webhook seguiria capturando o ganho de uma parcela que nunca vira `paid`, `isSettled` jamais
   * alcançaria `installment_count` e o carnê nunca quitaria — em silêncio.
   *
   * Driver que não informa `affectedRows` conta como sucesso: "não sei" não é "sumiu".
   */
  async markStatus(
    chargeId: string,
    status: InstallmentStatus,
    extra?: { paidAt?: Date; feeInCents?: number | null }
  ): Promise<boolean> {
    const set: Record<string, unknown> = { status, updatedAt: new Date() }
    // COALESCE, nunca atribuição direta: o Asaas REENTREGA eventos. Um PAYMENT_RECEIVED da
    // parcela paga em setembro reenviado em dezembro reescreveria a data de pagamento que o
    // admin vê no painel — não move dinheiro, mas corrompe data financeira. O caminho da
    // reconciliação já se protege disso de propósito (ver `paidChargeIds`); o do webhook não
    // tinha guarda nenhuma. A primeira data vencida é a verdadeira, então a que já está
    // gravada ganha sempre.
    //
    // A condição é sobre `paid_at` e não sobre `status` porque o MySQL avalia o SET da
    // esquerda para a direita e cada expressão enxerga o valor NOVO das colunas anteriores:
    // um `IF(status = 'paid', ...)` leria o status que este mesmo UPDATE acabou de gravar.
    //
    // `sql.param(..., orderInstallments.paidAt)` e não o Date cru: um parâmetro sem encoder
    // seria serializado pelo mysql2 no fuso da conexão, enquanto a coluna timestamp(3) é
    // gravada em UTC pelo drizzle no resto do arquivo — a data entraria deslocada.
    if (extra?.paidAt) {
      set.paidAt = sql`coalesce(${orderInstallments.paidAt}, ${sql.param(extra.paidAt, orderInstallments.paidAt)})`
    }
    if (extra?.feeInCents != null) set.asaasFeeInCents = extra.feeInCents
    const res = (await this.db
      .update(orderInstallments)
      .set(set)
      .where(eq(orderInstallments.asaasChargeId, chargeId))) as unknown as [{ affectedRows?: number }?]
    const affected = res?.[0]?.affectedRows
    return affected == null || affected > 0
  }

  /**
   * Localiza o pedido a partir de QUALQUER parcela. É isto que faz PAYMENT_OVERDUE e
   * PAYMENT_REFUNDED funcionarem num carnê: `orders.asaasChargeId` só guarda a cobrança que
   * quitou o pedido, então para as parcelas 2..N ele nunca casa — só a busca por
   * `order_installments.asaasChargeId` alcança qualquer parcela do carnê.
   */
  async findOrderIdByCharge(chargeId: string): Promise<string | null> {
    const rows = await this.db
      .select({ orderId: orderInstallments.orderId })
      .from(orderInstallments)
      .where(eq(orderInstallments.asaasChargeId, chargeId))
      .limit(1)
    return rows[0]?.orderId ?? null
  }

  /**
   * Cobranças do pedido já marcadas `paid` localmente. A reconciliação de carnês roda todo
   * dia enquanto o carnê não quita: sem este filtro, ela remarcaria (via markStatus) uma
   * parcela paga meses atrás toda vez que rodasse, reescrevendo `paidAt` com a data de HOJE.
   */
  async paidChargeIds(orderId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ chargeId: orderInstallments.asaasChargeId })
      .from(orderInstallments)
      .where(and(eq(orderInstallments.orderId, orderId), eq(orderInstallments.status, 'paid')))
    return new Set(rows.map((r) => r.chargeId))
  }

  /** Quitado quando o número de parcelas pagas alcança o total contratado. */
  async isSettled(orderId: string, expectedCount: number): Promise<boolean> {
    if (!expectedCount) return false
    const rows = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(orderInstallments)
      .where(and(eq(orderInstallments.orderId, orderId), eq(orderInstallments.status, 'paid')))
    return Number(rows[0]?.n ?? 0) >= expectedCount
  }

  /** Lista as parcelas de um pedido em ordem, no formato exposto ao aluno/admin. */
  async listForOrder(orderId: string): Promise<OrderInstallment[]> {
    const rows = await this.db
      .select()
      .from(orderInstallments)
      .where(eq(orderInstallments.orderId, orderId))
      .orderBy(orderInstallments.installmentNumber)
    return rows.map(toOrderInstallment)
  }
}
