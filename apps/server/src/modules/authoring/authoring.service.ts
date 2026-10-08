import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { and, asc, count, eq, inArray } from 'drizzle-orm'
import type { AuthoringModule, CourseStatus, InstructorCourse } from '@pilari/types'
import {
  categories, courses, lessonAttachments, lessons, modules, enrollments,
  quizQuestions, quizAttempts, lessonProgress, courseReviews, courseAnnouncements, lessonNotes, messages, certificates,
} from '../../db/schema'
import type { Database } from '../../db/types'
import { GcsService } from '../classroom/gcs.service'
import { CourseScopeService } from '../tenancy/course-scope.service'
import { slugify } from '../../common/lib/slugify'
import type { Actor } from '../../common/types/actor.type'
import { certificateWorkloadHours } from '../../common/lib/certificate-workload'
import { affectedRows, assertCourseHasLesson, statusChangedMeanwhile } from '../../common/lib/course-transition'
import { lessonsDurationSec } from '../../common/lib/lessons-duration'
import { decideStatusChange, lockedFieldChanges, lockedFieldsMessage } from './course-status-policy'
import { lessonDeletedLog, lessonDurationLog, lockedFieldsLog, moduleDeletedLog, statusChangedLog, type CourseChangeLog } from './course-change-log'

type CourseRow = typeof courses.$inferSelect

/** 409 da exclusão de curso que tem história (aprovação, aluno ou certificado). */
function cursoComHistoria(message: string): ConflictException {
  return new ConflictException({ statusCode: 409, code: 'COURSE_HAS_HISTORY', message })
}

export interface CreateCourseInput {
  title: string
  subtitle?: string | null
  description?: string | null
  categoryId?: string | null
  priceInCents?: number
}
export type UpdateCourseInput = Partial<{
  title: string
  subtitle: string | null
  description: string | null
  categoryId: string | null
  priceInCents: number
  /** Preço promocional (cents) ou null para limpar a promoção. */
  promoPriceInCents: number | null
  /** ISO ou null. Fim da promoção. */
  promoEndsAt: string | null
  coverImageUrl: string | null
  /** CSS object-position da capa (ex.: "50% 30%") ou null. */
  coverFocus: string | null
  coordinatorName: string | null
  coordinatorRole: string | null
  coordinatorSignaturePath: string | null
  workloadHours: number | null
  /** Tutor de voz com IA. Só admin liga: cada pergunta tem custo. */
  tutorEnabled: boolean
  /** ISO ou null. Define a data de liberação (pré-venda). */
  availableAt: string | null
}>

@Injectable()
export class AuthoringService {
  constructor(
    @Inject('DB_CLIENT') private readonly db: Database,
    private readonly gcs: GcsService,
    private readonly scope: CourseScopeService,
  ) {}

  // ── posse e polo ──────────────────────────────────────────────────────────
  // Toda posse passa por `this.scope.owned(actor, courseId)`: curso de outro polo → 404; curso de
  // outro instrutor no mesmo polo → 403, salvo para o admin do polo. Módulo e aula não têm polo
  // próprio: `scope.courseIdOfModule/Lesson` resolvem o curso já dentro do polo do ator.

  /**
   * Valida um valor que vai para `video_url`/`file_url`/`cover_image_url`. É aceito:
   *   - vazio;
   *   - URL http(s) externa (YouTube, imagem hospedada);
   *   - objeto do GCS DENTRO do prefixo do próprio curso (`cursos/<courseId>/…`).
   * Um objeto de OUTRO curso seria assinado com a service account (acesso ao bucket inteiro),
   * permitindo leitura cross-tenant — por isso é barrado. Também barra `javascript:`/`data:`.
   */
  private assertObjectPathScoped(value: string | null | undefined, courseId: string): void {
    if (!value) return
    if (/^https?:\/\//i.test(value)) return
    if (!value.startsWith(`cursos/${courseId}/`)) {
      throw new ForbiddenException('Caminho de arquivo inválido para este curso.')
    }
  }

  /**
   * A capa nova tem que ser imagem enviada para a capa DESTE curso (`cursos/<id>/cover/`, o caminho que o upload-url do
   * tipo "cover" gera) ou um link http(s). Sem isso, o vídeo ou o anexo do próprio curso viraria "capa", e o proxy
   * público da capa serviria esse arquivo para qualquer um. Só confere quando o valor MUDA: o editor manda o objeto
   * inteiro, e a capa antiga gravada antes desta regra continua salvando como está.
   */
  private assertCoverPath(novo: string | null | undefined, atual: string | null, courseId: string): void {
    if (!novo || novo === atual || /^https?:\/\//i.test(novo) || novo.startsWith(`cursos/${courseId}/cover/`)) return
    throw new BadRequestException({
      statusCode: 400,
      code: 'INVALID_COVER_PATH',
      message: 'A capa precisa ser uma imagem enviada pelo editor deste curso ou um link http(s).',
    })
  }

  /** A categoria do curso precisa ser do mesmo polo. */
  private async assertCategoryInTenant(tenantId: string, categoryId: string | null | undefined): Promise<void> {
    if (!categoryId) return
    const rows = await this.db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, categoryId), eq(categories.tenantId, tenantId)))
      .limit(1)
    if (!rows[0]) throw new BadRequestException('Categoria inválida para este polo.')
  }

  // ── cursos ──────────────────────────────────────────────────────────────────
  async listMine(actor: Actor): Promise<InstructorCourse[]> {
    const rows = await this.db
      .select()
      .from(courses)
      .where(and(eq(courses.instructorId, actor.uid), eq(courses.tenantId, actor.tenantId)))
      .orderBy(asc(courses.title))
    if (rows.length === 0) return []
    const ids = rows.map((c) => c.id)
    const modCounts = (await this.db
      .select({ courseId: modules.courseId, n: count(modules.id) })
      .from(modules)
      .where(inArray(modules.courseId, ids))
      .groupBy(modules.courseId)) as Array<{ courseId: string; n: number }>
    const lesCounts = (await this.db
      .select({ courseId: modules.courseId, n: count(lessons.id) })
      .from(lessons)
      .innerJoin(modules, eq(lessons.moduleId, modules.id))
      .where(inArray(modules.courseId, ids))
      .groupBy(modules.courseId)) as Array<{ courseId: string; n: number }>
    const modBy = new Map(modCounts.map((m) => [m.courseId, Number(m.n)]))
    const lesBy = new Map(lesCounts.map((l) => [l.courseId, Number(l.n)]))
    return rows.map((c) => this.toInstructorCourse(c, modBy.get(c.id) ?? 0, lesBy.get(c.id) ?? 0, actor.isPlatformAdmin))
  }

  /** Um único curso (meta + contagens) — admin-aware, p/ o editor abrir qualquer curso DO POLO. */
  async getOne(actor: Actor, courseId: string): Promise<InstructorCourse> {
    const c = await this.scope.owned(actor, courseId)
    const mc = (await this.db.select({ n: count(modules.id) }).from(modules).where(eq(modules.courseId, courseId))) as Array<{ n: number }>
    const lc = (await this.db
      .select({ n: count(lessons.id) })
      .from(lessons)
      .innerJoin(modules, eq(lessons.moduleId, modules.id))
      .where(eq(modules.courseId, courseId))) as Array<{ n: number }>
    return this.toInstructorCourse(c, Number(mc[0]?.n) || 0, Number(lc[0]?.n) || 0, actor.isPlatformAdmin)
  }

  /**
   * `viewerIsPlatformAdmin`: a trava dos dados do certificado vale para todo mundo menos para a
   * plataforma, então o `certificateFieldsLocked` depende de QUEM está vendo, não só do curso.
   */
  private toInstructorCourse(c: CourseRow, moduleCount: number, lessonCount: number, viewerIsPlatformAdmin = false): InstructorCourse {
    return {
      id: c.id, slug: c.slug, title: c.title, subtitle: c.subtitle, description: c.description,
      priceInCents: c.priceInCents, promoPriceInCents: c.promoPriceInCents ?? null,
      promoEndsAt: c.promoEndsAt ? c.promoEndsAt.toISOString() : null,
      coverImageUrl: c.coverImageUrl, coverFocus: c.coverFocus ?? null, categoryId: c.categoryId,
      coordinatorName: c.coordinatorName ?? null, coordinatorRole: c.coordinatorRole ?? null,
      certificateTemplateId: c.certificateTemplateId ?? null,
      coordinatorSignaturePath: c.coordinatorSignaturePath ?? null,
      workloadHours: c.workloadHours ?? null,
      tutorEnabled: !!c.tutorEnabled,
      status: c.status, moduleCount, lessonCount,
      availableAt: c.availableAt ? c.availableAt.toISOString() : null,
      approvedAt: c.approvedAt ? c.approvedAt.toISOString() : null,
      reviewNote: c.reviewNote ?? null,
      certificateFieldsLocked: c.approvedAt != null && !viewerIsPlatformAdmin,
    }
  }

  /** O slug é único DENTRO do polo: dois polos podem ter `excel-basico`. */
  private async uniqueSlug(tenantId: string, title: string): Promise<string> {
    const base = slugify(title) || 'curso'
    let candidate = base
    let n = 2
    while (true) {
      const clash = await this.db
        .select()
        .from(courses)
        .where(and(eq(courses.tenantId, tenantId), eq(courses.slug, candidate)))
        .limit(1)
      if (clash.length === 0) return candidate
      candidate = `${base}-${n++}`
    }
  }

  /** O curso nasce no polo do ator (o do endereço acessado), e a categoria tem que ser do mesmo polo. */
  async create(actor: Actor, input: CreateCourseInput): Promise<InstructorCourse> {
    await this.assertCategoryInTenant(actor.tenantId, input.categoryId)
    const id = randomUUID()
    const slug = await this.uniqueSlug(actor.tenantId, input.title)
    const now = new Date()
    await this.db.insert(courses).values({
      id, tenantId: actor.tenantId, slug, instructorId: actor.uid, categoryId: input.categoryId ?? null, kind: 'online',
      title: input.title, subtitle: input.subtitle ?? null, description: input.description ?? null,
      priceInCents: input.priceInCents ?? 0, coverImageUrl: null, status: 'draft', externalUrl: null,
      createdAt: now, updatedAt: now,
    })
    const rows = await this.db.select().from(courses).where(eq(courses.id, id)).limit(1)
    return this.toInstructorCourse(rows[0], 0, 0, actor.isPlatformAdmin)
  }

  /**
   * Salva os dados do curso. Devolve o curso salvo e, quando a plataforma muda dados do certificado de curso já aprovado,
   * o registro para o log do polo (`course.locked-fields`, com os campos mudados).
   */
  async updateMeta(actor: Actor, courseId: string, patch: UpdateCourseInput): Promise<{ course: InstructorCourse; log: CourseChangeLog | null }> {
    const c = await this.scope.owned(actor, courseId)
    if (patch.categoryId !== undefined) await this.assertCategoryInTenant(actor.tenantId, patch.categoryId)
    this.assertObjectPathScoped(patch.coverImageUrl, courseId)
    this.assertCoverPath(patch.coverImageUrl, c.coverImageUrl ?? null, courseId)
    // A04: com o curso publicado, mudança de preço/promoção por instrutor exige admin.
    // Compara com o valor atual porque o form manda o objeto inteiro — salvar sem mexer
    // no preço continua permitido.
    if (!actor.isAdmin && c.status === 'published') {
      const priceChanged =
        (patch.priceInCents !== undefined && patch.priceInCents !== c.priceInCents) ||
        (patch.promoPriceInCents !== undefined && patch.promoPriceInCents !== (c.promoPriceInCents ?? null)) ||
        (patch.promoEndsAt !== undefined &&
          (patch.promoEndsAt ? new Date(patch.promoEndsAt).getTime() : null) !== (c.promoEndsAt ? c.promoEndsAt.getTime() : null))
      if (priceChanged) {
        throw new ForbiddenException('Alteração de preço em curso publicado exige um admin.')
      }
    }
    // O coordenador assina o certificado: quem pode nomeá-lo é a instituição, não o
    // instrutor. Ignora silenciosamente em vez de recusar o save inteiro — o form manda
    // o objeto completo, e recusar travaria qualquer edição feita por instrutor.
    if (!actor.isAdmin) {
      delete patch.coordinatorName
      delete patch.coordinatorRole
      delete patch.coordinatorSignaturePath
    }
    // Tutor de voz: cada pergunta custa para o Studio Pilari (Vertex AI), então só a plataforma liga ou desliga,
    // nem o admin do polo. Descarta em silêncio, como o coordenador: o editor manda o formulário inteiro.
    if (!actor.isPlatformAdmin) delete patch.tutorEnabled
    // Depois da primeira aprovação, o que sai impresso no certificado só muda pela plataforma.
    // O editor manda o objeto inteiro: só barra o campo cujo valor MUDA de fato.
    const travados = lockedFieldChanges(c, patch, actor.isPlatformAdmin)
    if (travados.length) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'CERTIFICATE_FIELDS_LOCKED',
        message: lockedFieldsMessage(travados),
        fields: travados,
      })
    }
    // Quem passou pela trava com campo travado mudando é a plataforma: a mudança fica no log do polo.
    const mudadosPelaPlataforma = lockedFieldChanges(c, patch, false)
    // A rubrica é lida do bucket com a service account (rota /signature e emissão do diploma): um caminho
    // de OUTRO curso deixaria o admin de um polo baixar e imprimir arquivo alheio. Mesmo helper e mesmo erro
    // da capa. Só valida quando o valor MUDA (o editor manda o objeto inteiro) e remover (null) sempre passa.
    // Vem depois do descarte do instrutor e da trava do certificado, que já têm o seu próprio erro.
    const novaRubrica = patch.coordinatorSignaturePath
    if (novaRubrica && novaRubrica !== (c.coordinatorSignaturePath ?? null)) {
      this.assertObjectPathScoped(novaRubrica, courseId)
    }
    // Datas chegam como ISO/string e as colunas são timestamp → converte para Date (ou null).
    const { availableAt, promoEndsAt, ...rest } = patch
    const set: Record<string, unknown> = { ...rest, updatedAt: new Date() }
    if (availableAt !== undefined) set.availableAt = availableAt ? new Date(availableAt) : null
    if (promoEndsAt !== undefined) set.promoEndsAt = promoEndsAt ? new Date(promoEndsAt) : null
    await this.db.update(courses).set(set).where(and(eq(courses.id, courseId), eq(courses.tenantId, actor.tenantId)))
    const rows = await this.db.select().from(courses).where(eq(courses.id, courseId)).limit(1)
    return {
      course: this.toInstructorCourse(rows[0], 0, 0, actor.isPlatformAdmin),
      log: mudadosPelaPlataforma.length ? lockedFieldsLog(c, mudadosPelaPlataforma) : null,
    }
  }

  /**
   * Transições do curso pela política de aprovação (`decideStatusChange`): a primeira publicação de
   * curso de polo é do Studio Pilari, e na matriz o admin publica direto. Voltar a rascunho é livre.
   * Chamar para o status em que o curso já está não faz nada: sem checagem de aulas, sem gravação e sem registro no log.
   * A troca de verdade devolve o registro para o log do polo (o controller grava).
   */
  async setStatus(actor: Actor, courseId: string, status: CourseStatus): Promise<{ status: CourseStatus; log: CourseChangeLog | null }> {
    const c = await this.scope.owned(actor, courseId)
    if (c.status === status) return { status, log: null }
    const d = decideStatusChange({
      from: c.status, to: status, approvedAt: c.approvedAt ?? null, reviewNote: c.reviewNote ?? null,
      isTenantAdmin: actor.isAdmin, isPlatformAdmin: actor.isPlatformAdmin, isMatriz: actor.isMatriz,
    })
    if (!d.ok) {
      const body = { statusCode: d.status, code: d.code, message: d.message }
      throw d.status === 400 ? new BadRequestException(body) : new ForbiddenException(body)
    }
    if (status === 'published' || status === 'in_review') await assertCourseHasLesson(this.db, courseId)
    const now = new Date()
    const set: Partial<typeof courses.$inferInsert> = {
      status,
      publishedAt: status === 'published' && !c.publishedAt ? now : c.publishedAt,
      updatedAt: now,
    }
    if (d.markSubmitted) set.submittedAt = now
    if (d.markApproved) {
      set.approvedAt = now
      set.approvedBy = actor.uid
      // Sem carga horária definida, o certificado imprime a soma das aulas, e as aulas continuam editáveis depois
      // da aprovação. Grava-se a carga calculada na primeira aprovação, para ela ficar sob a trava do certificado.
      // Mesma regra da emissão (`certificateWorkloadHours`): carga definida vence e nada é trocado. A aprovação do
      // console da plataforma (`PlatformReviewService.approve`) faz o mesmo com estas duas funções: não divergir.
      const horas = certificateWorkloadHours(c.workloadHours, await lessonsDurationSec(this.db, courseId))
      if (horas !== (c.workloadHours ?? null)) set.workloadHours = horas
    }
    // A nota do Studio Pilari só some quando o curso é aprovado de novo: quem decide é a política.
    if (d.clearReviewNote) set.reviewNote = null
    // Grava só sobre a situação lida: se alguém mudou o curso no meio do caminho (o Studio Pilari devolveu enquanto o polo
    // publicava, por exemplo), a decisão foi tomada sobre um estado que não existe mais.
    const res = await this.db
      .update(courses)
      .set(set)
      .where(and(eq(courses.id, courseId), eq(courses.tenantId, actor.tenantId), eq(courses.status, c.status)))
    if (affectedRows(res) === 0) throw statusChangedMeanwhile()
    return { status, log: statusChangedLog(c, c.status, status) }
  }

  /**
   * Exclui o curso e todo o conteúdo dependente (sem deixar órfãos). Mantém o histórico financeiro (orders/earnings).
   *
   * Curso com história não se apaga. Para o polo, história é já ter sido aprovado, ter matrícula ou ter certificado:
   * o caminho é tirar do ar ou arquivar. A plataforma ainda exclui curso aprovado ou com aluno, como sempre fez, mas
   * não curso com certificado: o certificado é registro do Studio Pilari, e a verificação pelo QR tem que
   * continuar achando o curso. Devolve o curso excluído, para o log.
   *
   * A conferência da história e a cascata são uma transação só, com a linha do curso travada (`FOR UPDATE`): a aprovação
   * que chegue no meio espera, e a exclusão a enxerga (409) em vez de apagar um curso que acabou de ser aprovado. As
   * leituras de certificado e matrícula também são travadas (`FOR SHARE`): leem o que já foi gravado por outra transação
   * e seguram a inclusão de um certificado ou matrícula do curso até a exclusão terminar.
   */
  async remove(actor: Actor, courseId: string): Promise<CourseRow> {
    // Polo e posse primeiro (404 de outro polo, 403 de curso alheio): a regra mora no escopo.
    await this.scope.owned(actor, courseId)
    return this.db.transaction(async (tx) => {
      const [c] = await tx.select().from(courses).where(and(eq(courses.id, courseId), eq(courses.tenantId, actor.tenantId))).for('update')
      if (!c) throw new NotFoundException('Curso não encontrado.')
      const temCertificado = await this.temCertificado(tx, courseId)
      if (actor.isPlatformAdmin) {
        if (temCertificado) throw cursoComHistoria('Este curso tem certificados emitidos e não pode ser excluído. Tire o curso do ar.')
      } else if (c.approvedAt != null || temCertificado || (await this.temMatricula(tx, courseId))) {
        throw cursoComHistoria('Este curso já foi aprovado ou tem alunos e não pode ser excluído. Tire o curso do ar.')
      }

      const modRows = await tx.select({ id: modules.id }).from(modules).where(eq(modules.courseId, courseId))
      const moduleIds = modRows.map((m) => m.id)
      const lessonRows = moduleIds.length
        ? await tx.select({ id: lessons.id }).from(lessons).where(inArray(lessons.moduleId, moduleIds))
        : []
      const lessonIds = lessonRows.map((l) => l.id)

      if (lessonIds.length) {
        await tx.delete(lessonAttachments).where(inArray(lessonAttachments.lessonId, lessonIds))
        await tx.delete(lessonProgress).where(inArray(lessonProgress.lessonId, lessonIds))
      }
      if (moduleIds.length) {
        await tx.delete(quizQuestions).where(inArray(quizQuestions.moduleId, moduleIds))
        await tx.delete(quizAttempts).where(inArray(quizAttempts.moduleId, moduleIds))
        await tx.delete(lessons).where(inArray(lessons.moduleId, moduleIds))
      }
      await tx.delete(modules).where(eq(modules.courseId, courseId))
      await tx.delete(enrollments).where(eq(enrollments.courseId, courseId))
      await tx.delete(courseReviews).where(eq(courseReviews.courseId, courseId))
      await tx.delete(courseAnnouncements).where(eq(courseAnnouncements.courseId, courseId))
      await tx.delete(lessonNotes).where(eq(lessonNotes.courseId, courseId))
      await tx.delete(messages).where(eq(messages.courseId, courseId))
      // Certificado nunca é apagado junto: curso com certificado não chega aqui (ver acima).
      await tx.delete(courses).where(and(eq(courses.id, courseId), eq(courses.tenantId, actor.tenantId)))
      return c
    })
  }

  private async temCertificado(tx: Pick<Database, 'select'>, courseId: string): Promise<boolean> {
    const rows = await tx.select({ id: certificates.id }).from(certificates).where(eq(certificates.courseId, courseId)).limit(1).for('share')
    return rows.length > 0
  }

  /** Qualquer matrícula conta (ativa, pendente ou cancelada): é aluno que passou pelo curso. */
  private async temMatricula(tx: Pick<Database, 'select'>, courseId: string): Promise<boolean> {
    const rows = await tx.select({ id: enrollments.id }).from(enrollments).where(eq(enrollments.courseId, courseId)).limit(1).for('share')
    return rows.length > 0
  }

  async getDetail(actor: Actor, courseId: string): Promise<AuthoringModule[]> {
    await this.scope.owned(actor, courseId)
    const mods = await this.db.select().from(modules).where(eq(modules.courseId, courseId)).orderBy(asc(modules.order))
    const moduleIds = mods.map((m) => m.id)
    const lessonRows = moduleIds.length
      ? await this.db.select().from(lessons).where(inArray(lessons.moduleId, moduleIds)).orderBy(asc(lessons.order))
      : []
    const lessonIds = lessonRows.map((l) => l.id)
    const attachRows = lessonIds.length
      ? await this.db.select().from(lessonAttachments).where(inArray(lessonAttachments.lessonId, lessonIds))
      : []
    const attachBy = new Map<string, typeof attachRows>()
    for (const a of attachRows) {
      const arr = attachBy.get(a.lessonId) ?? []
      arr.push(a)
      attachBy.set(a.lessonId, arr)
    }
    // Resolve a URL baixável de cada anexo (assina o objeto do GCS) antes de montar o retorno.
    const urlBy = new Map<string, string>()
    await Promise.all(attachRows.map(async (a) => {
      urlBy.set(a.id, (await this.gcs.playableUrl(a.fileUrl)) ?? '')
    }))
    return mods.map((m) => ({
      id: m.id, title: m.title, order: m.order,
      availableAt: m.availableAt ? m.availableAt.toISOString() : null,
      lessons: lessonRows.filter((l) => l.moduleId === m.id).map((l) => ({
        id: l.id, title: l.title, description: l.description, videoUrl: l.videoUrl,
        durationSec: l.durationSec, order: l.order, isFreePreview: l.isFreePreview,
        attachments: (attachBy.get(l.id) ?? []).map((a) => ({ id: a.id, fileName: a.fileName, url: urlBy.get(a.id) ?? '' })),
      })),
    }))
  }

  // ── módulos ─────────────────────────────────────────────────────────────────
  async createModule(actor: Actor, courseId: string, title: string): Promise<{ id: string }> {
    await this.scope.owned(actor, courseId)
    const existing = await this.db.select({ id: modules.id }).from(modules).where(eq(modules.courseId, courseId))
    const id = randomUUID()
    const now = new Date()
    await this.db.insert(modules).values({ id, courseId, title, order: existing.length, createdAt: now, updatedAt: now })
    return { id }
  }

  async updateModule(actor: Actor, moduleId: string, title: string): Promise<void> {
    await this.scope.owned(actor, await this.scope.courseIdOfModule(actor.tenantId, moduleId))
    await this.db.update(modules).set({ title, updatedAt: new Date() }).where(eq(modules.id, moduleId))
  }

  /** Gotejamento: define (ou limpa) a data de liberação do módulo. */
  async setModuleRelease(actor: Actor, moduleId: string, availableAt: string | null): Promise<void> {
    await this.scope.owned(actor, await this.scope.courseIdOfModule(actor.tenantId, moduleId))
    await this.db.update(modules).set({ availableAt: availableAt ? new Date(availableAt) : null, updatedAt: new Date() }).where(eq(modules.id, moduleId))
  }

  /** Exclui o módulo. Em curso aprovado, devolve o registro para o log do polo. */
  async removeModule(actor: Actor, moduleId: string): Promise<CourseChangeLog | null> {
    const c = await this.scope.owned(actor, await this.scope.courseIdOfModule(actor.tenantId, moduleId))
    const modulo = c.approvedAt != null
      ? (await this.db.select({ title: modules.title }).from(modules).where(eq(modules.id, moduleId)).limit(1))[0]
      : undefined
    await this.db.delete(modules).where(eq(modules.id, moduleId))
    return modulo ? moduleDeletedLog(c, modulo.title) : null
  }

  async reorderModules(actor: Actor, courseId: string, orderedIds: string[]): Promise<void> {
    await this.scope.owned(actor, courseId)
    const now = new Date()
    for (let i = 0; i < orderedIds.length; i++) {
      await this.db.update(modules).set({ order: i, updatedAt: now }).where(and(eq(modules.id, orderedIds[i]), eq(modules.courseId, courseId)))
    }
  }

  // ── aulas ─────────────────────────────────────────────────────────────────
  async createLesson(actor: Actor, moduleId: string, title: string): Promise<{ id: string }> {
    await this.scope.owned(actor, await this.scope.courseIdOfModule(actor.tenantId, moduleId))
    const existing = await this.db.select({ id: lessons.id }).from(lessons).where(eq(lessons.moduleId, moduleId))
    const id = randomUUID()
    const now = new Date()
    await this.db.insert(lessons).values({
      id, moduleId, title, description: null, videoUrl: null, durationSec: 0, order: existing.length,
      isFreePreview: false, createdAt: now, updatedAt: now,
    })
    return { id }
  }

  /**
   * Salva a aula. Em curso aprovado, a mudança de duração devolve o registro para o log do polo (de → para): quando a
   * carga do curso é calculada, é dela que sai o número do certificado de quem ainda vai emitir.
   */
  async updateLesson(
    actor: Actor,
    lessonId: string,
    patch: Partial<{ title: string; description: string | null; videoUrl: string | null; durationSec: number; isFreePreview: boolean }>
  ): Promise<CourseChangeLog | null> {
    const courseId = await this.scope.courseIdOfLesson(actor.tenantId, lessonId)
    const c = await this.scope.owned(actor, courseId)
    this.assertObjectPathScoped(patch.videoUrl, courseId)
    let log: CourseChangeLog | null = null
    if (c.approvedAt != null && patch.durationSec !== undefined) {
      const [atual] = await this.db.select({ title: lessons.title, durationSec: lessons.durationSec }).from(lessons).where(eq(lessons.id, lessonId)).limit(1)
      if (atual && atual.durationSec !== patch.durationSec) log = lessonDurationLog(c, patch.title ?? atual.title, atual.durationSec, patch.durationSec)
    }
    await this.db.update(lessons).set({ ...patch, updatedAt: new Date() }).where(eq(lessons.id, lessonId))
    return log
  }

  /** Exclui a aula. Em curso aprovado, devolve o registro para o log do polo. */
  async removeLesson(actor: Actor, lessonId: string): Promise<CourseChangeLog | null> {
    const c = await this.scope.owned(actor, await this.scope.courseIdOfLesson(actor.tenantId, lessonId))
    const aula = c.approvedAt != null
      ? (await this.db.select({ title: lessons.title }).from(lessons).where(eq(lessons.id, lessonId)).limit(1))[0]
      : undefined
    await this.db.delete(lessons).where(eq(lessons.id, lessonId))
    return aula ? lessonDeletedLog(c, aula.title) : null
  }

  async reorderLessons(actor: Actor, moduleId: string, orderedIds: string[]): Promise<void> {
    await this.scope.owned(actor, await this.scope.courseIdOfModule(actor.tenantId, moduleId))
    const now = new Date()
    for (let i = 0; i < orderedIds.length; i++) {
      await this.db.update(lessons).set({ order: i, updatedAt: now }).where(and(eq(lessons.id, orderedIds[i]), eq(lessons.moduleId, moduleId)))
    }
  }

  // ── anexos ────────────────────────────────────────────────────────────────
  async addAttachment(actor: Actor, lessonId: string, fileName: string, fileUrl: string): Promise<{ id: string }> {
    const courseId = await this.scope.courseIdOfLesson(actor.tenantId, lessonId)
    await this.scope.owned(actor, courseId)
    this.assertObjectPathScoped(fileUrl, courseId)
    const id = randomUUID()
    await this.db.insert(lessonAttachments).values({ id, lessonId, fileName, fileUrl, createdAt: new Date() })
    return { id }
  }

  async removeAttachment(actor: Actor, attachmentId: string): Promise<void> {
    const rows = await this.db.select({ lessonId: lessonAttachments.lessonId }).from(lessonAttachments).where(eq(lessonAttachments.id, attachmentId)).limit(1)
    if (rows.length === 0) throw new NotFoundException('Anexo não encontrado.')
    await this.scope.owned(actor, await this.scope.courseIdOfLesson(actor.tenantId, rows[0].lessonId))
    await this.db.delete(lessonAttachments).where(eq(lessonAttachments.id, attachmentId))
  }
}
