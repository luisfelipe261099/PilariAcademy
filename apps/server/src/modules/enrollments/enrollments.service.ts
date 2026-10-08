import { Inject, Injectable } from '@nestjs/common'
import { and, count, desc, eq, inArray } from 'drizzle-orm'
import type { Enrollment } from '@pilari/types'
import { categories, courses, enrollments, lessons, modules } from '../../db/schema'
import { lessonProgress } from '../../db/schemas/progress.schema'
import type { Database } from '../../db/types'
import { coverUrl } from '../../common/lib/cover-url'
import { effectivePriceCents, listPriceCents, promoActive } from '../../common/lib/pricing'

type Row = {
  enrollment: typeof enrollments.$inferSelect
  course: typeof courses.$inferSelect
  category: typeof categories.$inferSelect | null
}

@Injectable()
export class EnrollmentsService {
  constructor(@Inject('DB_CLIENT') private readonly db: Database) {}

  async listForUser(tenantId: string, userUid: string): Promise<Enrollment[]> {
    const rows = (await this.db
      .select({ enrollment: enrollments, course: courses, category: categories })
      .from(enrollments)
      .innerJoin(courses, eq(enrollments.courseId, courses.id))
      .leftJoin(categories, eq(courses.categoryId, categories.id))
      .where(and(eq(enrollments.userId, userUid), eq(courses.tenantId, tenantId)))
      .orderBy(desc(enrollments.createdAt))) as Row[]

    if (rows.length === 0) return []
    const courseIds = rows.map((r) => r.course.id)

    const totals = (await this.db
      .select({ courseId: modules.courseId, total: count(lessons.id) })
      .from(lessons)
      .innerJoin(modules, eq(lessons.moduleId, modules.id))
      .where(inArray(modules.courseId, courseIds))
      .groupBy(modules.courseId)) as Array<{ courseId: string; total: number }>

    const dones = (await this.db
      .select({ courseId: modules.courseId, done: count(lessonProgress.id) })
      .from(lessonProgress)
      .innerJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
      .innerJoin(modules, eq(lessons.moduleId, modules.id))
      .where(and(eq(lessonProgress.userId, userUid), eq(lessonProgress.completed, true), inArray(modules.courseId, courseIds)))
      .groupBy(modules.courseId)) as Array<{ courseId: string; done: number }>

    const totalBy = new Map(totals.map((t) => [t.courseId, Number(t.total)]))
    const doneBy = new Map(dones.map((d) => [d.courseId, Number(d.done)]))

    return rows.map((r) => {
      const total = totalBy.get(r.course.id) ?? 0
      const done = doneBy.get(r.course.id) ?? 0
      return {
        id: r.enrollment.id,
        courseId: r.enrollment.courseId,
        status: r.enrollment.status,
        source: r.enrollment.source,
        paymentStatus: null,
        progressPercent: total === 0 ? 0 : Math.round((100 * done) / total),
        course: {
          id: r.course.id, slug: r.course.slug, title: r.course.title, subtitle: r.course.subtitle,
          kind: r.course.kind, priceInCents: effectivePriceCents(r.course), listPriceInCents: listPriceCents(r.course), promoEndsAt: r.course.promoEndsAt && promoActive(r.course) ? r.course.promoEndsAt.toISOString() : null,
          coverImageUrl: coverUrl(r.course.id, r.course.coverImageUrl), coverFocus: r.course.coverFocus ?? null,
          category: r.category ? { id: r.category.id, name: r.category.name, slug: r.category.slug } : null,
          instructorName: null,
          availableAt: r.course.availableAt ? r.course.availableAt.toISOString() : null,
        },
      }
    })
  }
}
