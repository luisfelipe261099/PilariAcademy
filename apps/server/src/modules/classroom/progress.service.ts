import { ForbiddenException, Inject, Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { enrollments } from '../../db/schema'
import { lessonProgress } from '../../db/schemas/progress.schema'
import type { Database } from '../../db/types'
import { CourseScopeService } from '../tenancy/course-scope.service'

@Injectable()
export class ProgressService {
  constructor(
    @Inject('DB_CLIENT') private readonly db: Database,
    private readonly scope: CourseScopeService
  ) {}

  async setProgress(tenantId: string, userUid: string, lessonId: string, completed: boolean): Promise<{ completed: boolean }> {
    const courseId = await this.scope.courseIdOfLesson(tenantId, lessonId)

    const enr = await this.db
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.userId, userUid), eq(enrollments.courseId, courseId), eq(enrollments.status, 'active')))
      .limit(1)
    if (enr.length === 0) throw new ForbiddenException('Você não tem acesso a este curso.')

    const now = new Date()
    const existing = await this.db
      .select()
      .from(lessonProgress)
      .where(and(eq(lessonProgress.userId, userUid), eq(lessonProgress.lessonId, lessonId)))
      .limit(1)

    if (existing.length === 0) {
      await this.db.insert(lessonProgress).values({
        id: randomUUID(), userId: userUid, lessonId, completed, completedAt: completed ? now : null, createdAt: now, updatedAt: now,
      })
    } else {
      await this.db
        .update(lessonProgress)
        .set({ completed, completedAt: completed ? now : null, updatedAt: now })
        .where(eq(lessonProgress.id, existing[0].id))
    }
    return { completed }
  }
}
