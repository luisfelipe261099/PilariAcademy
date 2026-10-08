import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import type { Announcement } from '@pilari/types'
import { enrollments, users } from '../../db/schema'
import { courseAnnouncements } from '../../db/schemas/engagement.schema'
import type { Database } from '../../db/types'
import type { Actor } from '../../common/types/actor.type'
import { CourseScopeService } from '../tenancy/course-scope.service'

/**
 * Anúncios por polo: todo curso (por slug ou id) e todo anúncio passam pelo `CourseScopeService`.
 * Curso, ou anúncio de curso, de outro polo responde 404; curso alheio no mesmo polo, 403.
 */
@Injectable()
export class AnnouncementsService {
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
    if (enr.length === 0) throw new ForbiddenException('Você não tem acesso a este curso.')
  }

  private async listByCourseId(courseId: string): Promise<Announcement[]> {
    const rows = (await this.db
      .select({ a: courseAnnouncements, authorName: users.displayName })
      .from(courseAnnouncements)
      .leftJoin(users, eq(courseAnnouncements.authorId, users.uid))
      .where(eq(courseAnnouncements.courseId, courseId))
      .orderBy(desc(courseAnnouncements.createdAt))) as Array<{ a: typeof courseAnnouncements.$inferSelect; authorName: string | null }>
    return rows.map(({ a, authorName }) => ({
      id: a.id, courseId: a.courseId, title: a.title, body: a.body, authorName, createdAt: a.createdAt?.toISOString() ?? '',
    }))
  }

  async listForStudent(tenantId: string, uid: string, slug: string): Promise<Announcement[]> {
    const course = await this.scope.bySlug(tenantId, slug)
    await this.assertEnrolled(uid, course.id)
    return this.listByCourseId(course.id)
  }

  async listForInstructor(actor: Actor, courseId: string): Promise<Announcement[]> {
    await this.scope.owned(actor, courseId)
    return this.listByCourseId(courseId)
  }

  async create(actor: Actor, courseId: string, title: string, body: string): Promise<Announcement> {
    await this.scope.owned(actor, courseId)
    const id = randomUUID()
    const now = new Date()
    await this.db.insert(courseAnnouncements).values({ id, courseId, authorId: actor.uid, title, body, createdAt: now })
    return { id, courseId, title, body, authorName: null, createdAt: now.toISOString() }
  }

  async remove(actor: Actor, announcementId: string): Promise<void> {
    const rows = await this.db.select().from(courseAnnouncements).where(eq(courseAnnouncements.id, announcementId)).limit(1)
    if (rows.length === 0) throw new NotFoundException('Anúncio não encontrado.')
    await this.scope.owned(actor, rows[0].courseId) // curso de outro polo vira 404
    await this.db.delete(courseAnnouncements).where(eq(courseAnnouncements.id, announcementId))
  }
}
