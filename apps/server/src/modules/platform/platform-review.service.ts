import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { and, asc, count, desc, eq, inArray, like, sql, type SQL } from 'drizzle-orm'
import type { CourseStatus, PlatformCourseRow, ReviewQueueItem } from '@pilari/types'
import { certificateWorkloadHours } from '../../common/lib/certificate-workload'
import { affectedRows, assertCourseHasLesson, statusChangedMeanwhile } from '../../common/lib/course-transition'
import { lessonsDurationSec, lessonsDurationSecByCourse } from '../../common/lib/lessons-duration'
import { courses, lessons, modules, tenants, users } from '../../db/schema'
import type { Database } from '../../db/types'
import { TenantsService } from '../tenancy/tenants.service'
import { reviewFingerprint } from './review-rules'

type CourseRow = typeof courses.$inferSelect

export interface ReviewedCourse {
  id: string
  title: string
  tenantId: string
  status: CourseStatus
}

function transicaoInvalida(message: string): BadRequestException {
  return new BadRequestException({ statusCode: 400, code: 'INVALID_TRANSITION', message })
}

function motivo(note: string): string {
  const texto = (note ?? '').trim()
  if (texto.length < 3 || texto.length > 1000) throw new BadRequestException('Escreva o motivo (3 a 1000 caracteres).')
  return texto
}

/**
 * A carga horária que o certificado imprime para o curso, e se ela vem da soma das aulas (`computed`): a carga definida
 * pelo polo vence e nada é trocado. É o número que a PRIMEIRA aprovação grava no curso (só quando `computed`), e a fila
 * mostra este mesmo resultado, para o revisor ver antes de aprovar o que o certificado vai imprimir. Curso que já foi
 * aprovado antes não grava de novo (sem retroativo), mas o número que o certificado imprime continua sendo este.
 */
function cargaCongelada(declarada: number | null, aulasSec: number): { hours: number; computed: boolean } {
  const hours = certificateWorkloadHours(declarada, aulasSec)
  return { hours, computed: hours !== (declarada ?? null) }
}

/** O fingerprint do curso com a carga que o certificado imprime: a fila e a aprovação calculam por aqui. */
function versaoDoCurso(c: CourseRow, cargaHoras: number): string {
  return reviewFingerprint({
    title: c.title, workloadHours: cargaHoras, coordinatorName: c.coordinatorName ?? null, coordinatorRole: c.coordinatorRole ?? null,
    coordinatorSignaturePath: c.coordinatorSignaturePath ?? null,
  })
}

/** Teto da lista de cursos da rede: a busca por título é o caminho para achar o resto. */
export const PLATFORM_COURSES_LIMIT = 200

/** O termo vira texto literal no LIKE: `%` e `_` digitados não são curingas. */
function escapeLike(termo: string): string {
  return termo.replace(/[\\%_]/g, (c) => `\\${c}`)
}

function cursoMudou(): ConflictException {
  return new ConflictException({
    statusCode: 409,
    code: 'COURSE_CHANGED',
    message: 'O curso mudou desde que a fila foi carregada. Recarregue e confira antes de aprovar.',
  })
}

/** Aprovação do Studio Pilari sobre os cursos de todos os polos. */
@Injectable()
export class PlatformReviewService {
  constructor(
    @Inject('DB_CLIENT') private readonly db: Database,
    private readonly tenantsService: TenantsService
  ) {}

  /**
   * Cursos de todos os polos, de qualquer situação, para a plataforma escolher (vínculo de modelos de certificado).
   * Busca por título; ordem: a matriz primeiro, depois os polos por nome, e o título dentro do polo.
   */
  async listCourses(q?: unknown): Promise<PlatformCourseRow[]> {
    const termo = typeof q === 'string' ? q.trim() : ''
    const base = this.db
      .select({
        id: courses.id, title: courses.title, slug: courses.slug, tenantId: courses.tenantId, tenantName: tenants.name,
        status: courses.status, certificateTemplateId: courses.certificateTemplateId,
      })
      .from(courses)
      .innerJoin(tenants, eq(tenants.id, courses.tenantId))
    const filtrada = termo ? base.where(like(courses.title, `%${escapeLike(termo)}%`)) : base
    const rows = await filtrada.orderBy(desc(tenants.isMatriz), asc(tenants.name), asc(courses.title), asc(courses.id)).limit(PLATFORM_COURSES_LIMIT)
    return rows.map((r) => ({ ...r, certificateTemplateId: r.certificateTemplateId ?? null }))
  }

  async queue(): Promise<ReviewQueueItem[]> {
    const rows = await this.db
      .select({ course: courses, tenantName: tenants.name, tenantSlug: tenants.slug, tenantIsMatriz: tenants.isMatriz, instructorName: users.displayName })
      .from(courses)
      .innerJoin(tenants, eq(tenants.id, courses.tenantId))
      .leftJoin(users, eq(users.uid, courses.instructorId))
      .where(eq(courses.status, 'in_review'))
      // Desempate pelo id: dois envios no mesmo instante saem sempre na mesma ordem.
      .orderBy(asc(courses.submittedAt), asc(courses.id))
    if (rows.length === 0) return []
    const ids = rows.map((r) => r.course.id)
    const mods = await this.db
      .select({ courseId: modules.courseId, n: count() })
      .from(modules)
      .where(inArray(modules.courseId, ids))
      .groupBy(modules.courseId)
    const aulas = await this.db
      .select({ courseId: modules.courseId, n: count() })
      .from(lessons)
      .innerJoin(modules, eq(lessons.moduleId, modules.id))
      .where(inArray(modules.courseId, ids))
      .groupBy(modules.courseId)
    const duracoes = await lessonsDurationSecByCourse(this.db, ids)
    return rows.map((r) => {
      const carga = cargaCongelada(r.course.workloadHours ?? null, duracoes.get(r.course.id) ?? 0)
      return {
        courseId: r.course.id,
        title: r.course.title,
        tenantId: r.course.tenantId,
        tenantName: r.tenantName,
        tenantSlug: r.tenantSlug,
        instructorName: r.instructorName,
        submittedAt: r.course.submittedAt ? r.course.submittedAt.toISOString() : null,
        moduleCount: Number(mods.find((m) => m.courseId === r.course.id)?.n ?? 0),
        lessonCount: Number(aulas.find((a) => a.courseId === r.course.id)?.n ?? 0),
        workloadHours: carga.hours,
        workloadIsComputed: carga.computed,
        coordinatorName: r.course.coordinatorName ?? null,
        coordinatorRole: r.course.coordinatorRole ?? null,
        hasCoordinatorSignature: !!r.course.coordinatorSignaturePath,
        firstApproval: r.course.approvedAt == null,
        reviewNote: r.course.reviewNote ?? null,
        fingerprint: versaoDoCurso(r.course, carga.hours),
        editorUrl: `${this.tenantsService.siteUrl({ slug: r.tenantSlug, isMatriz: !!r.tenantIsMatriz })}/instrutor/curso/${r.course.id}`,
      }
    })
  }

  /**
   * Aprova o curso que o revisor conferiu na fila: `fingerprint` é a versão que ele viu (título, carga, coordenador,
   * cargo e assinatura). Se o curso mudou desde então, 409 `COURSE_CHANGED` e nada é gravado.
   */
  async approve(uid: string, courseId: string, fingerprint: string): Promise<ReviewedCourse> {
    const c = await this.curso(courseId)
    if (c.status !== 'in_review') throw transicaoInvalida('Só um curso em análise pode ser aprovado.')
    // A mesma exigência do envio para análise (`setStatus`): as aulas podem ter sido apagadas depois do envio.
    await assertCourseHasLesson(this.db, courseId)
    const carga = cargaCongelada(c.workloadHours ?? null, await lessonsDurationSec(this.db, courseId))
    if (versaoDoCurso(c, carga.hours) !== fingerprint) throw cursoMudou()
    const agora = new Date()
    const set: Partial<typeof courses.$inferInsert> = {
      status: 'published',
      publishedAt: c.publishedAt ?? agora,
      // A primeira aprovação é a que vale para a trava do certificado. Data e autor são um par: só se grava o autor junto
      // com a data (como no `setStatus`). Curso que a migration carimbou como aprovado fica sem autor, não ganha o de quem reaprova.
      approvedAt: c.approvedAt ?? agora,
      approvedBy: c.approvedAt == null ? uid : c.approvedBy,
      reviewNote: null,
      updatedAt: agora,
    }
    // Sem carga horária definida, o certificado imprime a soma das aulas, e as aulas continuam editáveis depois da
    // aprovação. Grava-se a carga calculada na primeira aprovação, na MESMA gravação, para ela ficar sob a trava do
    // certificado. É a regra do `setStatus` (aprovação pela rota do instrutor), com as mesmas funções: não divergir.
    if (c.approvedAt == null && carga.computed) set.workloadHours = carga.hours
    // Além da situação, a gravação exige os dados travados como estavam quando o fingerprint foi conferido: o polo que
    // salve o curso entre a conferência e a gravação não tem a versão nova aprovada sem ninguém ver (409).
    const comoConferido: SQL[] = [
      eq(courses.title, c.title),
      sql`${courses.workloadHours} <=> ${c.workloadHours ?? null}`,
      sql`${courses.coordinatorName} <=> ${c.coordinatorName ?? null}`,
      sql`${courses.coordinatorRole} <=> ${c.coordinatorRole ?? null}`,
      sql`${courses.coordinatorSignaturePath} <=> ${c.coordinatorSignaturePath ?? null}`,
    ]
    await this.gravarSobre(c, set, comoConferido)
    return { id: c.id, title: c.title, tenantId: c.tenantId, status: 'published' }
  }

  async returnToDraft(courseId: string, note: string): Promise<ReviewedCourse> {
    const texto = motivo(note)
    const c = await this.curso(courseId)
    if (c.status !== 'in_review') throw transicaoInvalida('Só um curso em análise pode ser devolvido.')
    await this.gravarSobre(c, { status: 'draft', reviewNote: texto, updatedAt: new Date() })
    return { id: c.id, title: c.title, tenantId: c.tenantId, status: 'draft' }
  }

  /** Tira do ar curso publicado de qualquer polo. A nota impede o polo de republicar sem nova análise. */
  async takedown(courseId: string, note: string): Promise<ReviewedCourse> {
    const texto = motivo(note)
    const c = await this.curso(courseId)
    if (c.status !== 'published') throw transicaoInvalida('Só um curso publicado pode ser tirado do ar.')
    await this.gravarSobre(c, { status: 'draft', reviewNote: texto, updatedAt: new Date() })
    return { id: c.id, title: c.title, tenantId: c.tenantId, status: 'draft' }
  }

  /**
   * Grava a decisão só sobre a situação que foi lida (`status = <lido>` no WHERE, além do id e do polo do curso). Se o
   * curso mudou de situação no meio do caminho, nada é gravado e a resposta pede para recarregar.
   */
  private async gravarSobre(c: CourseRow, set: Partial<typeof courses.$inferInsert>, exigencias: SQL[] = []): Promise<void> {
    const res = await this.db
      .update(courses)
      .set(set)
      .where(and(eq(courses.id, c.id), eq(courses.tenantId, c.tenantId), eq(courses.status, c.status), ...exigencias))
    if (affectedRows(res) !== 0) return
    // Nada gravado: se a situação é a mesma, o que mudou foram os dados exigidos (o curso que a fila mostrou não existe
    // mais); senão, foi a situação.
    if (exigencias.length && (await this.curso(c.id)).status === c.status) throw cursoMudou()
    throw statusChangedMeanwhile()
  }

  private async curso(id: string): Promise<CourseRow> {
    const rows = await this.db.select().from(courses).where(eq(courses.id, id)).limit(1)
    if (!rows[0]) throw new NotFoundException('Curso não encontrado.')
    return rows[0]
  }
}
