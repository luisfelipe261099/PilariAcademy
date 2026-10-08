import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, inArray } from 'drizzle-orm'
import type { MyOrder, OrderInstallment } from '@pilari/types'
import { orders, enrollments, courses, orderInstallments } from '../../db/schema'
import type { Database } from '../../db/types'
import { toOrderInstallment } from './installments.service'

/**
 * Pedidos do PRÓPRIO aluno (página Financeiro).
 *
 * Serviço separado do `AdminOrdersService` de propósito, embora a montagem das linhas seja
 * quase igual: a única diferença entre "todos os pedidos" e "os pedidos deste aluno" é uma
 * cláusula WHERE, e é exatamente ali que um esquecimento expõe a compra de outra pessoa.
 * Com dois serviços, o filtro por `userId` não é um parâmetro opcional que alguém pode
 * deixar de passar — ele é a razão de existir deste arquivo.
 */
@Injectable()
export class MyOrdersService {
  constructor(@Inject('DB_CLIENT') private readonly db: Database) {}

  async list(tenantId: string, userUid: string): Promise<MyOrder[]> {
    const rows = await this.db
      .select({
        id: orders.id,
        status: orders.status,
        totalInCents: orders.totalInCents,
        billingType: orders.billingType,
        asaasInstallmentId: orders.asaasInstallmentId,
        paymentMode: orders.paymentMode,
        settledAt: orders.settledAt,
        paymentUrl: orders.paymentUrl,
        dueDate: orders.dueDate,
        paidAt: orders.paidAt,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(and(eq(orders.userId, userUid), eq(orders.tenantId, tenantId)))
      .orderBy(desc(orders.createdAt))
      .limit(100)

    if (rows.length === 0) return []
    const ids = rows.map((r) => r.id)

    // Títulos por pedido em UMA query (não uma por pedido).
    const titleRows = await this.db
      .select({ orderId: enrollments.orderId, title: courses.title })
      .from(enrollments)
      .innerJoin(courses, eq(courses.id, enrollments.courseId))
      .where(inArray(enrollments.orderId, ids))
    const titlesByOrder = new Map<string, string[]>()
    for (const t of titleRows) {
      if (!t.orderId) continue
      const arr = titlesByOrder.get(t.orderId) ?? []
      arr.push(t.title)
      titlesByOrder.set(t.orderId, arr)
    }

    // Parcelas de todos os carnês desta página em UMA query — mesmo motivo do admin: o pool
    // do mysql2 tem 10 conexões por padrão, e um SELECT por pedido esgotaria a instância.
    const installmentsByOrder = new Map<string, OrderInstallment[]>()
    const carneIds = rows.filter((r) => r.asaasInstallmentId).map((r) => r.id)
    if (carneIds.length) {
      const instRows = await this.db
        .select()
        .from(orderInstallments)
        .where(inArray(orderInstallments.orderId, carneIds))
        .orderBy(orderInstallments.orderId, orderInstallments.installmentNumber)
      for (const r of instRows) {
        const arr = installmentsByOrder.get(r.orderId) ?? []
        arr.push(toOrderInstallment(r))
        installmentsByOrder.set(r.orderId, arr)
      }
    }

    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      totalInCents: r.totalInCents,
      paymentMode: r.paymentMode ?? null,
      billingType: r.billingType ?? null,
      paymentUrl: r.paymentUrl ?? null,
      dueDate: r.dueDate ?? null,
      paidAt: r.paidAt ? r.paidAt.toISOString() : null,
      createdAt: r.createdAt ? r.createdAt.toISOString() : null,
      courseTitles: titlesByOrder.get(r.id) ?? [],
      installments: installmentsByOrder.get(r.id) ?? [],
      settledAt: r.settledAt ? r.settledAt.toISOString() : null,
      // Caminho SEM o prefixo /api de propósito: só funciona pela instância axios
      // autenticada, como blob. Num <a href> ele não carregaria o token e daria 401.
      carneUrl: r.asaasInstallmentId ? `/me/orders/${r.id}/carne` : null,
    }))
  }
}
