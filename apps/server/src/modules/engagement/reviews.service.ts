import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import type { CourseReview, CourseReviews } from '@pilari/types'
import { enrollments, users } from '../../db/schema'
import { courseReviews } from '../../db/schemas/engagement.schema'
import type { Database } from '../../db/types'
import { CourseScopeService } from '../tenancy/course-scope.service'

/**
 * Avaliações por polo: o slug é único só DENTRO do polo, então o curso é sempre resolvido pelo
 * `CourseScopeService`. Slug de outro polo responde 404.
 */
@Injectable()
export class ReviewsService {
  constructor(
    @Inject('DB_CLIENT') private readonly db: Database,
    private readonly scope: CourseScopeService
  ) {}

  private async assertEnrolled(uid: string, courseId: string): Promise<void> {
    const enr = await this.db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(and(eq(enrollments.userId, uid), eq(enrollments.courseId, courseId), eq(enrollments.status, 'active')))
      .limit(1)
    if (enr.length === 0) throw new ForbiddenException('Você precisa ter o curso para avaliá-lo.')
  }

  /**
   * Avaliações públicas (página do curso): só de curso publicado do polo do endereço. Curso fora do ar responde 404, como
   * no catálogo: as avaliações levam o nome de quem avaliou, e o curso tirado do ar não continua expondo isso.
   */
  async listPublic(tenantId: string, slug: string): Promise<CourseReviews> {
    const course = await this.scope.bySlug(tenantId, slug, { publishedOnly: true })
    return this.reviewsOf(course.id)
  }

  /**
   * Avaliações vistas pelo aluno logado (com "a minha"), na sala de aula do curso do polo do endereço. O mesmo filtro da
   * rota pública: estar logado não dá acesso aos nomes de quem avaliou um curso fora do ar (404, como inexistente).
   */
  async listForCourse(tenantId: string, slug: string, uid?: string): Promise<CourseReviews> {
    const course = await this.scope.bySlug(tenantId, slug, { publishedOnly: true })
    return this.reviewsOf(course.id, uid)
  }

  private async reviewsOf(courseId: string, uid?: string): Promise<CourseReviews> {
    const rows = (await this.db
      .select({ r: courseReviews, name: users.displayName })
      .from(courseReviews)
      .leftJoin(users, eq(courseReviews.userId, users.uid))
      .where(eq(courseReviews.courseId, courseId))
      .orderBy(desc(courseReviews.createdAt))) as Array<{ r: typeof courseReviews.$inferSelect; name: string | null }>
    // Payload público: NÃO expõe o UID do Firebase de cada avaliador (userId = null).
    const reviews: CourseReview[] = rows.map(({ r, name }) => ({
      id: r.id, userId: null, userName: name, rating: r.rating, comment: r.comment, createdAt: r.createdAt?.toISOString() ?? '',
    }))
    const count = reviews.length
    const average = count ? Math.round((reviews.reduce((s, x) => s + x.rating, 0) / count) * 10) / 10 : 0
    // "A minha" é resolvida a partir das linhas cruas (o UID some do array público acima).
    const mineRow = uid ? rows.find((x) => x.r.userId === uid) : undefined
    const mine: CourseReview | null = mineRow
      ? { id: mineRow.r.id, userId: mineRow.r.userId, userName: mineRow.name, rating: mineRow.r.rating, comment: mineRow.r.comment, createdAt: mineRow.r.createdAt?.toISOString() ?? '' }
      : null
    return { average, count, mine, reviews }
  }

  async upsertMine(tenantId: string, uid: string, slug: string, rating: number, comment: string | null): Promise<CourseReview> {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new BadRequestException('A nota deve ser de 1 a 5.')
    const course = await this.scope.bySlug(tenantId, slug)
    await this.assertEnrolled(uid, course.id)
    const existing = await this.db
      .select()
      .from(courseReviews)
      .where(and(eq(courseReviews.courseId, course.id), eq(courseReviews.userId, uid)))
      .limit(1)
    const now = new Date()
    if (existing[0]) {
      await this.db.update(courseReviews).set({ rating, comment, updatedAt: now }).where(eq(courseReviews.id, existing[0].id))
      return { id: existing[0].id, userId: uid, userName: null, rating, comment, createdAt: existing[0].createdAt?.toISOString() ?? now.toISOString() }
    }
    const id = randomUUID()
    await this.db.insert(courseReviews).values({ id, courseId: course.id, userId: uid, rating, comment, createdAt: now, updatedAt: now })
    return { id, userId: uid, userName: null, rating, comment, createdAt: now.toISOString() }
  }
}
