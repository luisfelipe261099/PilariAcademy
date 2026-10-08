import { ForbiddenException, Inject, Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm'
import type { ConversationSummary, Message, MessageThread } from '@pilari/types'
import { courses, enrollments, users } from '../../db/schema'
import { messages } from '../../db/schemas/messages.schema'
import type { Database } from '../../db/types'
import type { Actor } from '../../common/types/actor.type'
import { CourseScopeService } from '../tenancy/course-scope.service'

type MessageRow = typeof messages.$inferSelect

/**
 * Mensagens aluno↔instrutor por polo: todo curso (por slug ou id) passa pelo `CourseScopeService`.
 * Curso de outro polo responde 404; curso alheio no mesmo polo, 403 (salvo para o admin do polo).
 */
@Injectable()
export class MessagesService {
  constructor(
    @Inject('DB_CLIENT') private readonly db: Database,
    private readonly scope: CourseScopeService
  ) {}

  private toMessage(r: MessageRow): Message {
    return {
      id: r.id,
      courseId: r.courseId,
      studentId: r.studentId,
      senderId: r.senderId,
      fromStudent: r.senderId === r.studentId,
      body: r.body,
      createdAt: r.createdAt?.toISOString() ?? '',
      readAt: r.readAt?.toISOString() ?? null,
    }
  }

  private async assertEnrolled(uid: string, courseId: string): Promise<void> {
    const enr = await this.db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(and(eq(enrollments.userId, uid), eq(enrollments.courseId, courseId), eq(enrollments.status, 'active')))
      .limit(1)
    if (enr.length === 0) throw new ForbiddenException('Você não tem acesso a este curso.')
  }

  private async threadMessages(courseId: string, studentId: string): Promise<Message[]> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.courseId, courseId), eq(messages.studentId, studentId)))
      .orderBy(asc(messages.createdAt))
    return rows.map((r) => this.toMessage(r))
  }

  // ── aluno ─────────────────────────────────────────────────────────────────
  /** Thread do aluno num curso. Marca como lidas as mensagens recebidas do instrutor. */
  async studentThread(tenantId: string, uid: string, slug: string): Promise<MessageThread> {
    const course = await this.scope.bySlug(tenantId, slug)
    await this.assertEnrolled(uid, course.id)
    await this.db
      .update(messages)
      .set({ readAt: new Date() })
      .where(and(eq(messages.courseId, course.id), eq(messages.studentId, uid), ne(messages.senderId, uid), isNull(messages.readAt)))
    const msgs = await this.threadMessages(course.id, uid)
    return { courseId: course.id, courseTitle: course.title, studentId: uid, studentName: null, messages: msgs }
  }

  async studentSend(tenantId: string, uid: string, slug: string, body: string): Promise<Message> {
    const course = await this.scope.bySlug(tenantId, slug)
    await this.assertEnrolled(uid, course.id)
    const row: MessageRow = { id: randomUUID(), courseId: course.id, studentId: uid, senderId: uid, body, readAt: null, createdAt: new Date() }
    await this.db.insert(messages).values(row)
    return this.toMessage(row)
  }

  // ── instrutor ───────────────────────────────────────────────────────────────
  /** Caixa de entrada: conversas dos cursos do instrutor NESTE polo (ou de todos os cursos do polo, se admin). */
  async instructorConversations(actor: Actor): Promise<ConversationSummary[]> {
    const conds = [eq(courses.tenantId, actor.tenantId)]
    if (!actor.isAdmin) conds.push(eq(courses.instructorId, actor.uid))
    const courseRows = (await this.db
      .select({ id: courses.id, title: courses.title })
      .from(courses)
      .where(and(...conds))) as Array<{ id: string; title: string }>
    if (courseRows.length === 0) return []
    const titleBy = new Map(courseRows.map((c) => [c.id, c.title]))
    const courseIds = courseRows.map((c) => c.id)

    const msgs = await this.db
      .select()
      .from(messages)
      .where(inArray(messages.courseId, courseIds))
      .orderBy(asc(messages.createdAt))
    if (msgs.length === 0) return []

    const studentIds = [...new Set(msgs.map((m) => m.studentId))]
    const us = (await this.db.select({ uid: users.uid, name: users.displayName }).from(users).where(inArray(users.uid, studentIds))) as Array<{ uid: string; name: string | null }>
    const nameBy = new Map(us.map((u) => [u.uid, u.name]))

    const byConvo = new Map<string, ConversationSummary>()
    for (const m of msgs) {
      const key = `${m.courseId}::${m.studentId}`
      const fromStudent = m.senderId === m.studentId
      const existing = byConvo.get(key)
      if (!existing) {
        byConvo.set(key, {
          courseId: m.courseId,
          courseTitle: titleBy.get(m.courseId) ?? '',
          studentId: m.studentId,
          studentName: nameBy.get(m.studentId) ?? null,
          lastBody: m.body,
          lastAt: m.createdAt?.toISOString() ?? '',
          unread: fromStudent && !m.readAt ? 1 : 0,
        })
      } else {
        existing.lastBody = m.body
        existing.lastAt = m.createdAt?.toISOString() ?? ''
        if (fromStudent && !m.readAt) existing.unread += 1
      }
    }
    return [...byConvo.values()].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1))
  }

  /** Thread de uma conversa na visão do instrutor. Marca como lidas as mensagens do aluno. */
  async instructorThread(actor: Actor, courseId: string, studentId: string): Promise<MessageThread> {
    const course = await this.scope.owned(actor, courseId)
    await this.db
      .update(messages)
      .set({ readAt: new Date() })
      .where(and(eq(messages.courseId, courseId), eq(messages.studentId, studentId), eq(messages.senderId, studentId), isNull(messages.readAt)))
    const msgs = await this.threadMessages(courseId, studentId)
    const us = (await this.db.select({ name: users.displayName }).from(users).where(eq(users.uid, studentId)).limit(1)) as Array<{ name: string | null }>
    return { courseId, courseTitle: course.title, studentId, studentName: us[0]?.name ?? null, messages: msgs }
  }

  async instructorSend(actor: Actor, courseId: string, studentId: string, body: string): Promise<Message> {
    await this.scope.owned(actor, courseId)
    const row: MessageRow = { id: randomUUID(), courseId, studentId, senderId: actor.uid, body, readAt: null, createdAt: new Date() }
    await this.db.insert(messages).values(row)
    return this.toMessage(row)
  }
}
