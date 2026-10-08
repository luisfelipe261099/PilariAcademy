import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { and, desc, eq, gte, inArray, lt, sum } from 'drizzle-orm'
import type { AdminFinance, AdminSale, InstructorEarnings, PayoutRecord } from '@pilari/types'
import { courses, orders, users } from '../../db/schema'
import { earnings, payouts } from '../../db/schemas/finance.schema'
import type { Database } from '../../db/types'
import { CourseScopeService } from '../tenancy/course-scope.service'
import { TenantMembersService } from '../tenancy/tenant-members.service'

/** Financeiro por polo: ganhos, repasses e comissão leem e gravam só os dados do polo informado. */
@Injectable()
export class FinanceService {
  constructor(
    @Inject('DB_CLIENT') private readonly db: Database,
    private readonly members: TenantMembersService,
    private readonly scope: CourseScopeService
  ) {}

  /** Janela [início, fim) do mês 'YYYY-MM' (ou o mês atual, se não informado). */
  private monthWindow(month?: string): { ym: string; start: Date; end: Date } {
    const now = new Date()
    const ym = /^\d{4}-\d{2}$/.test(month ?? '') ? (month as string) : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const [yy, mm] = ym.split('-').map(Number)
    return { ym, start: new Date(yy, mm - 1, 1), end: new Date(yy, mm, 1) }
  }

  async adminSummary(tenantId: string, month?: string): Promise<AdminFinance> {
    const { ym, start, end } = this.monthWindow(month)

    const eAgg = (await this.db
      .select({ instructorId: earnings.instructorId, gross: sum(earnings.grossInCents), fee: sum(earnings.asaasFeeInCents), net: sum(earnings.netInCents) })
      .from(earnings)
      .where(eq(earnings.tenantId, tenantId))
      .groupBy(earnings.instructorId)) as Array<{ instructorId: string; gross: string | null; fee: string | null; net: string | null }>
    const pAgg = (await this.db
      .select({ instructorId: payouts.instructorId, paid: sum(payouts.amountInCents) })
      .from(payouts)
      .where(eq(payouts.tenantId, tenantId))
      .groupBy(payouts.instructorId)) as Array<{ instructorId: string; paid: string | null }>
    const mAgg = (await this.db
      .select({ instructorId: earnings.instructorId, net: sum(earnings.netInCents) })
      .from(earnings)
      .where(and(eq(earnings.tenantId, tenantId), gte(earnings.createdAt, start), lt(earnings.createdAt, end)))
      .groupBy(earnings.instructorId)) as Array<{ instructorId: string; net: string | null }>

    const ids = eAgg.map((e) => e.instructorId)
    const us = ids.length
      ? ((await this.db.select({ uid: users.uid, name: users.displayName }).from(users).where(inArray(users.uid, ids))) as Array<{ uid: string; name: string | null }>)
      : []
    const nameBy = new Map(us.map((u) => [u.uid, u.name]))
    const paidBy = new Map(pAgg.map((p) => [p.instructorId, Number(p.paid) || 0]))
    const monthBy = new Map(mAgg.map((m) => [m.instructorId, Number(m.net) || 0]))

    let grossInCents = 0
    let asaasFeeInCents = 0
    let netInCents = 0
    let monthNetInCents = 0
    const instructors = eAgg.map((e) => {
      const g = Number(e.gross) || 0
      const n = Number(e.net) || 0
      const monthNet = monthBy.get(e.instructorId) ?? 0
      grossInCents += g
      asaasFeeInCents += Number(e.fee) || 0
      netInCents += n
      monthNetInCents += monthNet
      const paid = paidBy.get(e.instructorId) ?? 0
      return { instructorId: e.instructorId, instructorName: nameBy.get(e.instructorId) ?? null, netInCents: n, paidInCents: paid, owedInCents: n - paid, monthNetInCents: monthNet }
    })
    const sales = await this.listSales(tenantId)
    // Lucro da plataforma = bruto − taxa Asaas − repasse aos parceiros.
    return { grossInCents, asaasFeeInCents, commissionInCents: grossInCents - asaasFeeInCents - netInCents, netInCents, month: ym, monthNetInCents, instructors, sales }
  }

  /** Vendas pagas (quem comprou) com o split já calculado, mais recentes primeiro. */
  private async listSales(tenantId: string, limit = 100): Promise<AdminSale[]> {
    const agg = (await this.db
      .select({ orderId: earnings.orderId, gross: sum(earnings.grossInCents), fee: sum(earnings.asaasFeeInCents), net: sum(earnings.netInCents) })
      .from(earnings)
      .where(eq(earnings.tenantId, tenantId))
      .groupBy(earnings.orderId)) as Array<{ orderId: string; gross: string | null; fee: string | null; net: string | null }>
    if (!agg.length) return []

    const ids = agg.map((a) => a.orderId)
    const ords = (await this.db.select({ id: orders.id, userId: orders.userId, paidAt: orders.paidAt }).from(orders).where(inArray(orders.id, ids))) as Array<{ id: string; userId: string; paidAt: Date | null }>
    const orderById = new Map(ords.map((o) => [o.id, o]))
    const buyerIds = [...new Set(ords.map((o) => o.userId))]
    const buyers = buyerIds.length
      ? ((await this.db.select({ uid: users.uid, name: users.displayName, email: users.email }).from(users).where(inArray(users.uid, buyerIds))) as Array<{ uid: string; name: string | null; email: string }>)
      : []
    const buyerBy = new Map(buyers.map((b) => [b.uid, b]))
    // groupBy(orderId, title) em vez de DISTINCT: um carnê grava 1 `earnings` por PARCELA de
    // cada curso, então sem isso o join devolveria o mesmo título N vezes (N = parcelas pagas).
    const titleRows = (await this.db
      .select({ orderId: earnings.orderId, title: courses.title })
      .from(earnings)
      .innerJoin(courses, eq(courses.id, earnings.courseId))
      .where(inArray(earnings.orderId, ids))
      .groupBy(earnings.orderId, courses.title)) as Array<{ orderId: string; title: string }>
    const titlesBy = new Map<string, string[]>()
    for (const t of titleRows) {
      const arr = titlesBy.get(t.orderId) ?? []
      // Defesa em profundidade: o GROUP BY já deduplica no banco, mas não custa nada garantir
      // aqui também — a lista alimenta `courseTitles.join(', ')` no FinanceManager.tsx.
      if (!arr.includes(t.title)) arr.push(t.title)
      titlesBy.set(t.orderId, arr)
    }

    const sales: AdminSale[] = agg.map((a) => {
      const o = orderById.get(a.orderId)
      const buyer = o ? buyerBy.get(o.userId) : undefined
      const gross = Number(a.gross) || 0
      const fee = Number(a.fee) || 0
      const net = Number(a.net) || 0
      return {
        orderId: a.orderId,
        buyerName: buyer?.name ?? null,
        buyerEmail: buyer?.email ?? null,
        courseTitles: titlesBy.get(a.orderId) ?? [],
        grossInCents: gross,
        asaasFeeInCents: fee,
        netInCents: net,
        platformInCents: gross - fee - net,
        paidAt: o?.paidAt ? o.paidAt.toISOString() : null,
      }
    })
    sales.sort((x, y) => (y.paidAt ?? '').localeCompare(x.paidAt ?? ''))
    return sales.slice(0, limit)
  }

  async instructorEarnings(tenantId: string, uid: string): Promise<InstructorEarnings> {
    const eAgg = (await this.db
      .select({ net: sum(earnings.netInCents) })
      .from(earnings)
      .where(and(eq(earnings.instructorId, uid), eq(earnings.tenantId, tenantId)))) as Array<{ net: string | null }>
    const pAgg = (await this.db
      .select({ paid: sum(payouts.amountInCents) })
      .from(payouts)
      .where(and(eq(payouts.instructorId, uid), eq(payouts.tenantId, tenantId)))) as Array<{ paid: string | null }>
    const list = await this.db
      .select()
      .from(payouts)
      .where(and(eq(payouts.instructorId, uid), eq(payouts.tenantId, tenantId)))
      .orderBy(desc(payouts.paidAt))
    const net = Number(eAgg[0]?.net) || 0
    const paid = Number(pAgg[0]?.paid) || 0
    return {
      netInCents: net,
      paidInCents: paid,
      owedInCents: net - paid,
      payouts: list.map((p) => ({ id: p.id, amountInCents: p.amountInCents, note: p.note, paidAt: p.paidAt?.toISOString() ?? '' })),
    }
  }

  /** Repasse a um parceiro DO POLO; quem não tem vínculo com o polo responde 404, como se não existisse. */
  async registerPayout(tenantId: string, instructorId: string, amountInCents: number, note?: string): Promise<PayoutRecord> {
    if (!(await this.members.isMember(tenantId, instructorId))) throw new NotFoundException('Parceiro não encontrado neste polo.')
    const id = randomUUID()
    const now = new Date()
    await this.db.insert(payouts).values({ id, tenantId, instructorId, amountInCents, note: note ?? null, paidAt: now, createdAt: now })
    return { id, amountInCents, note: note ?? null, paidAt: now.toISOString() }
  }

  /** Comissão de um curso DO POLO; curso de outro polo responde 404. */
  async setCommission(tenantId: string, courseId: string, commissionPercent: number): Promise<{ commissionPercent: number }> {
    await this.scope.byId(tenantId, courseId)
    await this.db.update(courses).set({ commissionPercent, updatedAt: new Date() }).where(and(eq(courses.id, courseId), eq(courses.tenantId, tenantId)))
    return { commissionPercent }
  }
}
