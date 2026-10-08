import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import { courses, lessons, modules } from '../../db/schema'
import type { Database } from '../../db/types'
import type { Actor } from '../../common/types/actor.type'

export type CourseRow = typeof courses.$inferSelect

/**
 * Ponto único da regra "este curso é deste polo". Todo acesso a curso, módulo ou aula por slug
 * ou id passa por aqui. Fora do polo responde 404, para não revelar que existe em outro polo.
 */
@Injectable()
export class CourseScopeService {
  constructor(@Inject('DB_CLIENT') private readonly db: Database) {}

  async bySlug(tenantId: string, slug: string, opts: { publishedOnly?: boolean } = {}): Promise<CourseRow> {
    const conds = [eq(courses.tenantId, tenantId), eq(courses.slug, slug)]
    if (opts.publishedOnly) conds.push(eq(courses.status, 'published'))
    const rows = await this.db.select().from(courses).where(and(...conds)).limit(1)
    if (!rows[0]) throw new NotFoundException('Curso não encontrado.')
    return rows[0]
  }

  async byId(tenantId: string, courseId: string): Promise<CourseRow> {
    const rows = await this.db
      .select()
      .from(courses)
      .where(and(eq(courses.tenantId, tenantId), eq(courses.id, courseId)))
      .limit(1)
    if (!rows[0]) throw new NotFoundException('Curso não encontrado.')
    return rows[0]
  }

  /** Curso do polo em que o ator pode mexer: o instrutor dono ou um admin do polo. */
  async owned(actor: Actor, courseId: string): Promise<CourseRow> {
    const c = await this.byId(actor.tenantId, courseId)
    if (!actor.isAdmin && c.instructorId !== actor.uid) throw new ForbiddenException('Você não é o dono deste curso.')
    return c
  }

  async courseIdOfModule(tenantId: string, moduleId: string): Promise<string> {
    const rows = await this.db
      .select({ courseId: modules.courseId })
      .from(modules)
      .innerJoin(courses, eq(courses.id, modules.courseId))
      .where(and(eq(modules.id, moduleId), eq(courses.tenantId, tenantId)))
      .limit(1)
    if (!rows[0]) throw new NotFoundException('Módulo não encontrado.')
    return rows[0].courseId
  }

  async courseIdOfLesson(tenantId: string, lessonId: string): Promise<string> {
    const rows = await this.db
      .select({ courseId: modules.courseId })
      .from(lessons)
      .innerJoin(modules, eq(lessons.moduleId, modules.id))
      .innerJoin(courses, eq(courses.id, modules.courseId))
      .where(and(eq(lessons.id, lessonId), eq(courses.tenantId, tenantId)))
      .limit(1)
    if (!rows[0]) throw new NotFoundException('Aula não encontrada.')
    return rows[0].courseId
  }
}
