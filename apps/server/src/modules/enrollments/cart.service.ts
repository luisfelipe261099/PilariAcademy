import { Inject, Injectable } from '@nestjs/common'
import { and, eq, inArray } from 'drizzle-orm'
import type { CartSummary, CourseSummary } from '@pilari/types'
import { categories, courses, users } from '../../db/schema'
import type { Database } from '../../db/types'
import { coverUrl } from '../../common/lib/cover-url'
import { effectivePriceCents, listPriceCents, promoActive } from '../../common/lib/pricing'
import { CouponsService } from './coupons.service'

type JoinedRow = {
  course: typeof courses.$inferSelect
  category: typeof categories.$inferSelect | null
  instructorName: string | null
}

@Injectable()
export class CartService {
  constructor(
    @Inject('DB_CLIENT') private readonly db: Database,
    private readonly coupons: CouponsService
  ) {}

  private toSummary(row: JoinedRow): CourseSummary {
    const c = row.course
    return {
      id: c.id, slug: c.slug, title: c.title, subtitle: c.subtitle, kind: c.kind,
      priceInCents: effectivePriceCents(c), listPriceInCents: listPriceCents(c), promoEndsAt: c.promoEndsAt && promoActive(c) ? c.promoEndsAt.toISOString() : null,
      coverImageUrl: coverUrl(c.id, c.coverImageUrl), coverFocus: c.coverFocus ?? null,
      category: row.category ? { id: row.category.id, name: row.category.name, slug: row.category.slug } : null,
      instructorName: row.instructorName,
      availableAt: c.availableAt ? c.availableAt.toISOString() : null,
    }
  }

  async summary(tenantId: string, courseIds: string[], couponCode?: string, now: Date = new Date()): Promise<CartSummary> {
    if (courseIds.length === 0) {
      return { items: [], subtotalInCents: 0, discountInCents: 0, totalInCents: 0, couponCode: null, couponError: null }
    }

    const rows = (await this.db
      .select({ course: courses, category: categories, instructorName: users.displayName })
      .from(courses)
      .leftJoin(categories, eq(courses.categoryId, categories.id))
      .leftJoin(users, eq(courses.instructorId, users.uid))
      .where(and(eq(courses.tenantId, tenantId), inArray(courses.id, courseIds), eq(courses.status, 'published'), eq(courses.kind, 'online')))) as JoinedRow[]

    const items = rows.map((r) => this.toSummary(r))
    const subtotalInCents = items.reduce((sum, i) => sum + i.priceInCents, 0)

    let discountInCents = 0
    let couponError: string | null = null
    let appliedCode: string | null = null
    if (couponCode) {
      const v = await this.coupons.validateAndCalc(tenantId, couponCode, subtotalInCents, now)
      discountInCents = v.discountInCents
      couponError = v.couponError
      appliedCode = v.couponError ? null : couponCode.toUpperCase()
    }

    return {
      items,
      subtotalInCents,
      discountInCents,
      totalInCents: Math.max(0, subtotalInCents - discountInCents),
      couponCode: appliedCode,
      couponError,
    }
  }
}
