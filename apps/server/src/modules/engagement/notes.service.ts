import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import type { LessonNote } from '@pilari/types'
import { enrollments, lessons } from '../../db/schema'
import { lessonNotes } from '../../db/schemas/engagement.schema'
import type { Database } from '../../db/types'
import { CourseScopeService } from '../tenancy/course-scope.service'

/**
 * Anotações por polo: o curso (por slug), a aula e o curso da anotação passam pelo
 * `CourseScopeService`. Curso, aula ou anotação de outro polo responde 404.
 */
@Injectable()
export class NotesService {
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

  async listForCourse(tenantId: string, uid: string, slug: string): Promise<LessonNote[]> {
    const course = await this.scope.bySlug(tenantId, slug)
    await this.assertEnrolled(uid, course.id)
    const rows = (await this.db
      .select({ n: lessonNotes, lessonTitle: lessons.title })
      .from(lessonNotes)
      .leftJoin(lessons, eq(lessonNotes.lessonId, lessons.id))
      .where(and(eq(lessonNotes.userId, uid), eq(lessonNotes.courseId, course.id)))
      .orderBy(asc(lessonNotes.createdAt))) as Array<{ n: typeof lessonNotes.$inferSelect; lessonTitle: string | null }>
    return rows.map(({ n, lessonTitle }) => ({
      id: n.id, lessonId: n.lessonId, lessonTitle, atSec: n.atSec, body: n.body, createdAt: n.createdAt?.toISOString() ?? '',
    }))
  }

  async create(tenantId: string, uid: string, lessonId: string, atSec: number, body: string): Promise<LessonNote> {
    const courseId = await this.scope.courseIdOfLesson(tenantId, lessonId)
    await this.assertEnrolled(uid, courseId)
    const id = randomUUID()
    const now = new Date()
    await this.db.insert(lessonNotes).values({ id, userId: uid, courseId, lessonId, atSec: Math.max(0, Math.round(atSec)), body, createdAt: now })
    return { id, lessonId, lessonTitle: null, atSec: Math.max(0, Math.round(atSec)), body, createdAt: now.toISOString() }
  }

  async remove(tenantId: string, uid: string, noteId: string): Promise<void> {
    const rows = await this.db
      .select({ id: lessonNotes.id, courseId: lessonNotes.courseId })
      .from(lessonNotes)
      .where(and(eq(lessonNotes.id, noteId), eq(lessonNotes.userId, uid)))
      .limit(1)
    if (rows.length === 0) throw new NotFoundException('Observação não encontrada.')
    await this.scope.byId(tenantId, rows[0].courseId) // anotação de curso de outro polo vira 404
    await this.db.delete(lessonNotes).where(eq(lessonNotes.id, noteId))
  }
}
