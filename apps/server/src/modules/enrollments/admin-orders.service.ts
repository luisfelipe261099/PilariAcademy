import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { and, desc, eq, inArray } from 'drizzle-orm'
import type { AdminOrderRow, OrderInstallment } from '@pilari/types'
import { orders, users, enrollments, courses, orderInstallments } from '../../db/schema'
import type { Database } from '../../db/types'
import { toOrderInstallment } from './installments.service'

/** Leitura das cobranças (pedidos) para o painel admin. Só os pedidos do polo informado. */
@Injectable()
export class AdminOrdersService {
  constructor(@Inject('DB_CLIENT') private readonly db: Database) {}

  /**
   * 404 se o pedido não é deste polo. As ações manuais (baixa, cancelamento, quitação do carnê) agem
   * pelo id do pedido, sem polo no WebhookService: quem as chama confere aqui antes.
   */
  async assertInTenant(tenantId: string, orderId: string): Promise<void> {
    const rows = await this.db.select({ id: orders.id }).from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId))).limit(1)
    if (!rows[0]) throw new NotFoundException('Pedido não encontrado.')
  }

  async list(tenantId: string): Promise<AdminOrderRow[]> {
    const rows = await this.db
      .select({
        id: orders.id,
        userEmail: users.email,
        userName: users.displayName,
        status: orders.status,
        totalInCents: orders.totalInCents,
        billingType: orders.billingType,
        installmentCount: orders.installmentCount,
        asaasChargeId: orders.asaasChargeId,
        asaasInstallmentId: orders.asaasInstallmentId,
        paymentMode: orders.paymentMode,
        settledAt: orders.settledAt,
        paymentUrl: orders.paymentUrl,
        dueDate: orders.dueDate,
        paidAt: orders.paidAt,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .leftJoin(users, eq(users.uid, orders.userId))
      .where(eq(orders.tenantId, tenantId))
      .orderBy(desc(orders.createdAt))
      .limit(300)

    // Títulos dos cursos por pedido (via matrículas), em 1 query só.
    const ids = rows.map((r) => r.id)
    const titleRows = ids.length
      ? await this.db
          .select({ orderId: enrollments.orderId, title: courses.title })
          .from(enrollments)
          .innerJoin(courses, eq(courses.id, enrollments.courseId))
          .where(inArray(enrollments.orderId, ids))
      : []
    const titlesByOrder = new Map<string, string[]>()
    for (const t of titleRows) {
      if (!t.orderId) continue
      const arr = titlesByOrder.get(t.orderId) ?? []
      arr.push(t.title)
      titlesByOrder.set(t.orderId, arr)
    }

    // Parcelas do carnê: 1 query só para TODOS os pedidos carnê da página (mesmo padrão de
    // titlesByOrder acima) — NUNCA 1 query por pedido. O carnê é o propósito desta feature,
    // não um caso raro: `createPool` (db/database.module.ts) não define `connectionLimit`,
    // então vale o default do mysql2 (10). Um N+1 aqui (mesmo em paralelo via Promise.all)
    // enfileiraria até 300 SELECTs numa única carga de página e esgotaria o pool inteiro,
    // travando qualquer outra requisição na instância.
    const installmentsByOrder = new Map<string, OrderInstallment[]>()
    const carneOrderIds = rows.filter((r) => r.asaasInstallmentId).map((r) => r.id)
    if (carneOrderIds.length) {
      const installmentRows = await this.db
        .select()
        .from(orderInstallments)
        .where(inArray(orderInstallments.orderId, carneOrderIds))
        .orderBy(orderInstallments.orderId, orderInstallments.installmentNumber)
      for (const r of installmentRows) {
        const arr = installmentsByOrder.get(r.orderId) ?? []
        arr.push(toOrderInstallment(r))
        installmentsByOrder.set(r.orderId, arr)
      }
    }

    return rows.map((r) => ({
      id: r.id,
      userEmail: r.userEmail ?? null,
      userName: r.userName ?? null,
      status: r.status,
      totalInCents: r.totalInCents,
      billingType: r.billingType ?? null,
      installmentCount: r.installmentCount ?? null,
      asaasChargeId: r.asaasChargeId ?? null,
      paymentUrl: r.paymentUrl ?? null,
      dueDate: r.dueDate ?? null,
      paidAt: r.paidAt ? r.paidAt.toISOString() : null,
      createdAt: r.createdAt ? r.createdAt.toISOString() : null,
      courseTitles: titlesByOrder.get(r.id) ?? [],
      paymentMode: r.paymentMode ?? null,
      installments: installmentsByOrder.get(r.id) ?? [],
      settledAt: r.settledAt ? r.settledAt.toISOString() : null,
    }))
  }
}
