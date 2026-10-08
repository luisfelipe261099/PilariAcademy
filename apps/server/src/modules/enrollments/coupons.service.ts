import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import type { Coupon, CouponType } from '@pilari/types'
import { coupons, couponRedemptions } from '../../db/schema'
import type { Database } from '../../db/types'
import { isDuplicateEntry } from '../../common/lib/db-errors'

/** Resultado bruto de um UPDATE no mysql2 (o header traz `affectedRows`). */
type MysqlUpdateResult = [{ affectedRows: number }, unknown]

type CouponRow = typeof coupons.$inferSelect

export interface CreateCouponInput {
  code: string
  type: CouponType
  value: number
  validUntil?: Date | null
  maxUses?: number | null
}

@Injectable()
export class CouponsService {
  constructor(@Inject('DB_CLIENT') private readonly db: Database) {}

  private toCoupon(row: CouponRow): Coupon {
    return { id: row.id, code: row.code, type: row.type, value: row.value, active: row.active }
  }

  async list(tenantId: string): Promise<Coupon[]> {
    const rows = await this.db.select().from(coupons).where(eq(coupons.tenantId, tenantId))
    return rows.map((r) => this.toCoupon(r))
  }

  private async getOwned(tenantId: string, id: string): Promise<CouponRow> {
    const rows = await this.db.select().from(coupons).where(and(eq(coupons.tenantId, tenantId), eq(coupons.id, id))).limit(1)
    if (!rows[0]) throw new NotFoundException('Cupom não encontrado.')
    return rows[0]
  }

  async create(tenantId: string, input: CreateCouponInput): Promise<Coupon> {
    const id = randomUUID()
    const now = new Date()
    try {
      await this.db.insert(coupons).values({
        id, tenantId, code: input.code.toUpperCase(), type: input.type, value: input.value,
        validUntil: input.validUntil ?? null, maxUses: input.maxUses ?? null,
        usedCount: 0, active: true, createdAt: now, updatedAt: now,
      })
    } catch (e) {
      if (isDuplicateEntry(e)) throw new ConflictException('Já existe um cupom com este código neste polo.')
      throw e
    }
    return this.toCoupon(await this.getOwned(tenantId, id))
  }

  async update(tenantId: string, id: string, patch: Partial<{ active: boolean; value: number; validUntil: Date | null }>): Promise<Coupon> {
    await this.getOwned(tenantId, id)
    await this.db.update(coupons).set({ ...patch, updatedAt: new Date() }).where(and(eq(coupons.tenantId, tenantId), eq(coupons.id, id)))
    return this.toCoupon(await this.getOwned(tenantId, id))
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.getOwned(tenantId, id)
    await this.db.delete(coupons).where(and(eq(coupons.tenantId, tenantId), eq(coupons.id, id)))
  }

  /**
   * Reserva UM uso de forma ATÔMICA: incrementa `usedCount` só se ainda houver saldo
   * (`maxUses` nulo ou `usedCount < maxUses`). Retorna `true` se reservou, `false` se esgotado.
   * Fecha a race condition do maxUses e é o gate único de contagem (some com o `incrementUse`
   * desacoplado). Deve ser chamado tanto no checkout pago quanto no grátis (total = 0).
   */
  async reserveUse(tenantId: string, code: string): Promise<boolean> {
    const res = (await this.db
      .update(coupons)
      .set({ usedCount: sql`${coupons.usedCount} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(coupons.tenantId, tenantId),
          eq(coupons.code, code.toUpperCase()),
          sql`(${coupons.maxUses} is null or ${coupons.usedCount} < ${coupons.maxUses})`
        )
      )) as unknown as MysqlUpdateResult
    return res[0].affectedRows > 0
  }

  /** true se este usuário já resgatou este cupom NESTE POLO (teto POR USUÁRIO — 1 resgate por aluno). */
  async alreadyRedeemed(tenantId: string, code: string, userUid: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: couponRedemptions.id })
      .from(couponRedemptions)
      .where(and(eq(couponRedemptions.tenantId, tenantId), eq(couponRedemptions.couponCode, code.toUpperCase()), eq(couponRedemptions.userId, userUid)))
      .limit(1)
    return rows.length > 0
  }

  /** Devolve um uso reservado (compensação quando o checkout falha após o reserveUse). */
  async releaseUse(tenantId: string, code: string): Promise<void> {
    await this.db
      .update(coupons)
      .set({ usedCount: sql`greatest(${coupons.usedCount} - 1, 0)`, updatedAt: new Date() })
      .where(and(eq(coupons.tenantId, tenantId), eq(coupons.code, code.toUpperCase())))
  }

  /** Valida o cupom (só dentro do polo) e calcula o desconto sobre o subtotal (centavos). */
  async validateAndCalc(
    tenantId: string,
    code: string,
    subtotalInCents: number,
    now: Date
  ): Promise<{ discountInCents: number; couponError: string | null; coupon: Coupon | null }> {
    const rows = await this.db
      .select()
      .from(coupons)
      .where(and(eq(coupons.tenantId, tenantId), eq(coupons.code, code.toUpperCase())))
      .limit(1)
    const c = rows[0]
    if (!c) return { discountInCents: 0, couponError: 'Cupom inválido.', coupon: null }
    if (!c.active) return { discountInCents: 0, couponError: 'Cupom inativo.', coupon: null }
    if (c.validUntil && c.validUntil < now) return { discountInCents: 0, couponError: 'Cupom expirado.', coupon: null }
    if (c.maxUses != null && c.usedCount >= c.maxUses) return { discountInCents: 0, couponError: 'Cupom esgotado.', coupon: null }

    const raw = c.type === 'percent' ? Math.floor((subtotalInCents * c.value) / 100) : c.value
    const discountInCents = Math.min(raw, subtotalInCents)
    return { discountInCents, couponError: null, coupon: this.toCoupon(c) }
  }
}
