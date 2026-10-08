import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import type { AuthoringQuestion, CourseGrades, QuizForStudent, QuizResult } from '@pilari/types'
import { enrollments, modules } from '../../db/schema'
import { quizQuestions, quizAttempts } from '../../db/schemas/quiz.schema'
import type { Database } from '../../db/types'
import type { Actor } from '../../common/types/actor.type'
import { questionDeletedLog, type CourseChangeLog } from '../authoring/course-change-log'
import { CourseScopeService, type CourseRow } from '../tenancy/course-scope.service'
import type { TenantContext } from '../tenancy/tenant-context'

const PASS = 70
/** Tentativas por rodada. Uma "liberação" (repetente) soma +1 rodada = +5 tentativas por módulo. */
const ATTEMPTS_PER_ROUND = 5

export interface QuestionInput {
  prompt: string
  options: string[]
  correctIndex: number
  /** Peso em pontos (a soma da prova deve dar 10). Ausente → default do banco (2,00). */
  points?: number
}

/**
 * Provas por polo: todo módulo e todo curso (por slug ou id) passam pelo `CourseScopeService`.
 * Módulo ou curso de outro polo responde 404; curso alheio no mesmo polo, 403 (salvo para o admin do polo).
 */
@Injectable()
export class QuizService {
  constructor(
    @Inject('DB_CLIENT') private readonly db: Database,
    private readonly scope: CourseScopeService
  ) {}

  /** O módulo é do polo do ator e o curso dele é do ator (ou o ator é admin do polo). Devolve o curso. */
  private async assertOwns(actor: Actor, moduleId: string): Promise<CourseRow> {
    return this.scope.owned(actor, await this.scope.courseIdOfModule(actor.tenantId, moduleId))
  }

  // ── instrutor ───────────────────────────────────────────────────────────────
  async listQuestions(actor: Actor, moduleId: string): Promise<AuthoringQuestion[]> {
    await this.assertOwns(actor, moduleId)
    const rows = await this.db.select().from(quizQuestions).where(eq(quizQuestions.moduleId, moduleId)).orderBy(asc(quizQuestions.order))
    return rows.map((r) => ({ id: r.id, prompt: r.prompt, options: r.options, correctIndex: r.correctIndex, order: r.order, points: Number(r.points) }))
  }

  async createQuestion(actor: Actor, moduleId: string, input: QuestionInput): Promise<{ id: string }> {
    await this.assertOwns(actor, moduleId)
    const existing = await this.db.select({ id: quizQuestions.id }).from(quizQuestions).where(eq(quizQuestions.moduleId, moduleId))
    const id = randomUUID()
    const now = new Date()
    await this.db.insert(quizQuestions).values({
      id, moduleId, prompt: input.prompt, options: input.options, correctIndex: input.correctIndex, order: existing.length, createdAt: now, updatedAt: now,
      ...(input.points != null ? { points: input.points.toFixed(2) } : {}),
    })
    return { id }
  }

  async updateQuestion(actor: Actor, questionId: string, patch: Partial<QuestionInput>): Promise<void> {
    const rows = await this.db.select().from(quizQuestions).where(eq(quizQuestions.id, questionId)).limit(1)
    if (rows.length === 0) throw new NotFoundException('Questão não encontrada.')
    await this.assertOwns(actor, rows[0].moduleId)
    const { points, ...rest } = patch
    await this.db
      .update(quizQuestions)
      .set({ ...rest, ...(points != null ? { points: points.toFixed(2) } : {}), updatedAt: new Date() })
      .where(eq(quizQuestions.id, questionId))
  }

  /** Exclui a questão. Em curso aprovado, devolve o registro para o log do polo. */
  async removeQuestion(actor: Actor, questionId: string): Promise<CourseChangeLog | null> {
    const rows = await this.db.select().from(quizQuestions).where(eq(quizQuestions.id, questionId)).limit(1)
    if (rows.length === 0) throw new NotFoundException('Questão não encontrada.')
    const c = await this.assertOwns(actor, rows[0].moduleId)
    let log: CourseChangeLog | null = null
    if (c.approvedAt != null) {
      const [modulo] = await this.db.select({ title: modules.title }).from(modules).where(eq(modules.id, rows[0].moduleId)).limit(1)
      log = questionDeletedLog(c, modulo?.title ?? '', rows[0].prompt)
    }
    await this.db.delete(quizQuestions).where(eq(quizQuestions.id, questionId))
    return log
  }

  // ── aluno ───────────────────────────────────────────────────────────────────
  /** Matrícula ativa do aluno no curso (com o contador de rodadas). 403 se não tem acesso. */
  private async getActiveEnrollment(uid: string, courseId: string): Promise<typeof enrollments.$inferSelect> {
    const rows = await this.db
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.userId, uid), eq(enrollments.courseId, courseId), eq(enrollments.status, 'active')))
      .limit(1)
    if (rows.length === 0) throw new ForbiddenException('Você não tem acesso a este curso.')
    return rows[0]
  }

  async getForStudent(tenantId: string, uid: string, moduleId: string): Promise<QuizForStudent> {
    const courseId = await this.scope.courseIdOfModule(tenantId, moduleId)
    const enrollment = await this.getActiveEnrollment(uid, courseId)
    const rows = await this.db.select().from(quizQuestions).where(eq(quizQuestions.moduleId, moduleId)).orderBy(asc(quizQuestions.order))
    const attempts = await this.db.select().from(quizAttempts).where(and(eq(quizAttempts.userId, uid), eq(quizAttempts.moduleId, moduleId))).orderBy(desc(quizAttempts.createdAt))
    const maxAttempts = ATTEMPTS_PER_ROUND * (enrollment.quizAttemptRounds ?? 1)
    const bestScore = attempts.length ? Math.max(...attempts.map((a) => a.score)) : null
    return {
      moduleId,
      questions: rows.map((r) => ({ id: r.id, prompt: r.prompt, options: r.options, points: Number(r.points) })),
      bestScore,
      lastScore: attempts[0]?.score ?? null,
      passed: bestScore !== null && bestScore >= PASS,
      attemptsUsed: attempts.length,
      maxAttempts,
      locked: attempts.length >= maxAttempts,
    }
  }

  async submit(tenant: Pick<TenantContext, 'id' | 'isMatriz'>, uid: string, moduleId: string, answers: Record<string, number>): Promise<QuizResult> {
    const courseId = await this.scope.courseIdOfModule(tenant.id, moduleId)
    const enrollment = await this.getActiveEnrollment(uid, courseId)
    const prior = await this.db.select().from(quizAttempts).where(and(eq(quizAttempts.userId, uid), eq(quizAttempts.moduleId, moduleId)))
    const maxAttempts = ATTEMPTS_PER_ROUND * (enrollment.quizAttemptRounds ?? 1)
    if (prior.length >= maxAttempts) {
      // Quem libera novas tentativas é o professor do curso ou o admin do polo (`releaseCourseQuizzes`). Nos polos a
      // equipe do Studio Pilari não atende o aluno: o caminho é o professor ou o polo.
      throw new BadRequestException(
        tenant.isMatriz
          ? 'Tentativas esgotadas neste módulo. Fale com o Studio Pilari para liberar novas tentativas.'
          : 'Tentativas esgotadas neste módulo. Fale com o professor do curso ou com o seu polo para liberar novas tentativas.'
      )
    }
    const qs = await this.db.select().from(quizQuestions).where(eq(quizQuestions.moduleId, moduleId))
    if (qs.length === 0) throw new BadRequestException('Este módulo não tem prova.')

    const totalPts = qs.reduce((s, q) => s + Number(q.points), 0)
    const earnedPts = qs.filter((q) => answers[q.id] === q.correctIndex).reduce((s, q) => s + Number(q.points), 0)
    const score = totalPts > 0 ? Math.round((100 * earnedPts) / totalPts) : 0
    const passed = score >= PASS

    await this.db.insert(quizAttempts).values({ id: randomUUID(), userId: uid, moduleId, score, passed, createdAt: new Date() })

    const attemptsUsed = prior.length + 1
    const bestScore = Math.max(score, ...prior.map((a) => a.score))
    return { score, passed, bestScore, attemptsUsed, maxAttempts, locked: attemptsUsed >= maxAttempts }
  }

  /** Boletim do aluno: melhor nota (0–10) por módulo com prova + média final. */
  async courseGrade(uid: string, courseId: string): Promise<CourseGrades> {
    const mods = (await this.db
      .select({ id: modules.id, title: modules.title, order: modules.order })
      .from(modules)
      .where(eq(modules.courseId, courseId))
      .orderBy(asc(modules.order))) as Array<{ id: string; title: string; order: number }>

    const withQuiz = (await this.db
      .select({ moduleId: quizQuestions.moduleId })
      .from(quizQuestions)
      .innerJoin(modules, eq(quizQuestions.moduleId, modules.id))
      .where(eq(modules.courseId, courseId))
      .groupBy(quizQuestions.moduleId)) as Array<{ moduleId: string }>
    const quizModules = new Set(withQuiz.map((m) => m.moduleId))

    const attempts = (await this.db
      .select({ moduleId: quizAttempts.moduleId, score: quizAttempts.score })
      .from(quizAttempts)
      .innerJoin(modules, eq(quizAttempts.moduleId, modules.id))
      .where(and(eq(modules.courseId, courseId), eq(quizAttempts.userId, uid)))) as Array<{ moduleId: string; score: number }>
    const bestByModule = new Map<string, number>()
    for (const a of attempts) bestByModule.set(a.moduleId, Math.max(a.score, bestByModule.get(a.moduleId) ?? 0))

    const moduleGrades = mods.map((m) => {
      const hasQuiz = quizModules.has(m.id)
      const best = bestByModule.has(m.id) ? bestByModule.get(m.id)! : null
      const grade = best !== null ? best / 10 : null
      const passed = hasQuiz ? best !== null && best >= PASS : true
      return { moduleId: m.id, title: m.title, hasQuiz, grade, passed }
    })

    const graded = moduleGrades.filter((m) => m.hasQuiz)
    const finalGrade = graded.length ? Math.round((graded.reduce((s, m) => s + (m.grade ?? 0), 0) / graded.length) * 10) / 10 : null
    const approved = graded.every((m) => m.passed)
    return { modules: moduleGrades, finalGrade, approved }
  }

  /** Boletim do aluno resolvido pelo slug do curso DO POLO (checa matrícula ativa). */
  async courseGradeBySlug(tenantId: string, uid: string, slug: string): Promise<CourseGrades> {
    const course = await this.scope.bySlug(tenantId, slug)
    await this.getActiveEnrollment(uid, course.id)
    return this.courseGrade(uid, course.id)
  }

  /** Boletim de um aluno visto por admin do polo ou instrutor dono do curso. */
  async courseGradeForStaff(actor: Actor, courseId: string, studentUid: string): Promise<CourseGrades> {
    await this.scope.owned(actor, courseId)
    return this.courseGrade(studentUid, courseId)
  }

  /** Libera +1 rodada de tentativas (todo o curso) para um aluno. Admin do polo ou dono do curso. */
  async releaseCourseQuizzes(actor: Actor, courseId: string, studentUid: string): Promise<{ ok: true }> {
    await this.scope.owned(actor, courseId)
    await this.db
      .update(enrollments)
      .set({ quizAttemptRounds: sql`${enrollments.quizAttemptRounds} + 1`, updatedAt: new Date() })
      .where(and(eq(enrollments.userId, studentUid), eq(enrollments.courseId, courseId)))
    return { ok: true }
  }

  /** Para o certificado: todos os módulos com prova têm uma tentativa aprovada do aluno? */
  async allModuleQuizzesPassed(uid: string, courseId: string): Promise<boolean> {
    const mods = (await this.db
      .select({ moduleId: quizQuestions.moduleId })
      .from(quizQuestions)
      .innerJoin(modules, eq(quizQuestions.moduleId, modules.id))
      .where(eq(modules.courseId, courseId))
      .groupBy(quizQuestions.moduleId)) as Array<{ moduleId: string }>
    if (mods.length === 0) return true
    const passedRows = (await this.db
      .select({ moduleId: quizAttempts.moduleId })
      .from(quizAttempts)
      .where(and(eq(quizAttempts.userId, uid), eq(quizAttempts.passed, true)))
      .groupBy(quizAttempts.moduleId)) as Array<{ moduleId: string }>
    const passed = new Set(passedRows.map((p) => p.moduleId))
    return mods.every((m) => passed.has(m.moduleId))
  }
}
