import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Classroom, ClassroomModule } from '@pilari/types'
import { enrollments, lessonAttachments, lessons, modules, users } from '../../db/schema'
import { lessonProgress } from '../../db/schemas/progress.schema'
import { quizQuestions, quizAttempts } from '../../db/schemas/quiz.schema'
import type { Database } from '../../db/types'
import { courseUnavailable } from '../../common/lib/course-unavailable'
import { CourseScopeService } from '../tenancy/course-scope.service'
import type { TenantContext } from '../tenancy/tenant-context'
import { GcsService } from './gcs.service'
import { FileProxyService } from './file-proxy.service'

@Injectable()
export class ClassroomService {
  constructor(
    @Inject('DB_CLIENT') private readonly db: Database,
    private readonly gcs: GcsService,
    private readonly fileProxy: FileProxyService,
    private readonly scope: CourseScopeService
  ) {}

  async getClassroom(tenant: Pick<TenantContext, 'id' | 'isMatriz'>, userUid: string, slug: string): Promise<Classroom> {
    // Slug é único só DENTRO do polo: sem o polo, o mesmo slug abriria o curso de outro.
    const course = await this.scope.bySlug(tenant.id, slug)

    // Pré-venda: comprou, mas o conteúdo só abre em `availableAt`. Antes da data, fica bloqueado.
    const locked = !!course.availableAt && course.availableAt.getTime() > Date.now()

    const enr = await this.db
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.userId, userUid), eq(enrollments.courseId, course.id), eq(enrollments.status, 'active')))
      .limit(1)
    // Curso fora do ar (rascunho, em análise, arquivado): o matriculado recebe o aviso; para quem não é, o curso não
    // existe (404, como no catálogo), para não revelar rascunho.
    if (course.status !== 'published') {
      if (enr.length > 0) throw courseUnavailable(tenant.isMatriz)
      throw new NotFoundException('Curso não encontrado.')
    }
    if (enr.length === 0) throw new ForbiddenException('Você não tem acesso a este curso.')

    const mods = await this.db.select().from(modules).where(eq(modules.courseId, course.id)).orderBy(asc(modules.order))
    const moduleIds = mods.map((m) => m.id)
    const lessonRows = moduleIds.length
      ? await this.db.select().from(lessons).where(inArray(lessons.moduleId, moduleIds)).orderBy(asc(lessons.order))
      : []
    const lessonIds = lessonRows.map((l) => l.id)
    const attachRows = lessonIds.length
      ? await this.db.select().from(lessonAttachments).where(inArray(lessonAttachments.lessonId, lessonIds))
      : []
    const progressRows = lessonIds.length
      ? await this.db.select().from(lessonProgress).where(and(eq(lessonProgress.userId, userUid), inArray(lessonProgress.lessonId, lessonIds)))
      : []

    // Quais módulos têm prova e quais o aluno já passou (a prova vira um item no fim do módulo).
    const quizModRows = moduleIds.length
      ? ((await this.db.select({ moduleId: quizQuestions.moduleId }).from(quizQuestions).where(inArray(quizQuestions.moduleId, moduleIds)).groupBy(quizQuestions.moduleId)) as Array<{ moduleId: string }>)
      : []
    const withQuiz = new Set(quizModRows.map((r) => r.moduleId))
    const passedRows = moduleIds.length
      ? ((await this.db
          .select({ moduleId: quizAttempts.moduleId })
          .from(quizAttempts)
          .where(and(eq(quizAttempts.userId, userUid), eq(quizAttempts.passed, true), inArray(quizAttempts.moduleId, moduleIds)))
          .groupBy(quizAttempts.moduleId)) as Array<{ moduleId: string }>)
      : []
    const quizPassedSet = new Set(passedRows.map((r) => r.moduleId))

    const completed = new Set(progressRows.filter((p) => p.completed).map((p) => p.lessonId))
    const attachByLesson = new Map<string, typeof attachRows>()
    for (const a of attachRows) {
      const arr = attachByLesson.get(a.lessonId) ?? []
      arr.push(a)
      attachByLesson.set(a.lessonId, arr)
    }

    const builtModules: ClassroomModule[] = []
    for (const m of mods) {
      // Gotejamento: módulo com data futura fica bloqueado (e o curso em pré-venda trava tudo).
      const moduleLocked = !!m.availableAt && m.availableAt.getTime() > Date.now()
      const lessonLocked = locked || moduleLocked
      const ls = lessonRows.filter((l) => l.moduleId === m.id)
      const builtLessons = []
      for (const l of ls) {
        // Bloqueado: não expõe vídeo/anexos tocáveis, só a estrutura.
        const signedVideoUrl = lessonLocked ? null : await this.gcs.playableUrl(l.videoUrl)
        const attachments = []
        if (!lessonLocked) {
          for (const a of attachByLesson.get(l.id) ?? []) {
            // PDF de objeto do GCS → servido pelo domínio do app (proxy), evitando o iframe
            // apontar pro storage.googleapis.com (que dispara bloqueio de DevTools corporativo).
            // Demais anexos / links externos seguem com a URL assinada / direta.
            const isPdf = /\.pdf$/i.test(a.fileName)
            const isGcsObject = !!a.fileUrl && !/^https?:\/\//i.test(a.fileUrl)
            const url = isPdf && isGcsObject
              ? this.fileProxy.proxyPdfUrl(a.id)
              : (await this.gcs.playableUrl(a.fileUrl)) ?? ''
            attachments.push({ id: a.id, fileName: a.fileName, url })
          }
        }
        builtLessons.push({
          id: l.id, title: l.title, description: l.description, durationSec: l.durationSec, order: l.order,
          signedVideoUrl, attachments, completed: completed.has(l.id),
        })
      }
      builtModules.push({
        id: m.id, title: m.title, order: m.order, lessons: builtLessons,
        hasQuiz: withQuiz.has(m.id), quizPassed: quizPassedSet.has(m.id),
        availableAt: m.availableAt ? m.availableAt.toISOString() : null, locked: moduleLocked,
      })
    }

    const total = lessonRows.length
    const progressPercent = total === 0 ? 0 : Math.round((100 * completed.size) / total)

    const meRows = await this.db.select({ cpf: users.cpf, displayName: users.displayName }).from(users).where(eq(users.uid, userUid)).limit(1)
    const hasCpf = !!(meRows[0]?.cpf && meRows[0].cpf.replace(/\D/g, '').length === 11)
    // Nome com arroba é o e-mail que o fallback antigo gravou como "nome": não serve
    // para o documento, então conta como ausente e a tela vai pedir o nome de verdade.
    const nomeCadastrado = (meRows[0]?.displayName ?? '').trim()
    const hasName = nomeCadastrado.length > 0 && !nomeCadastrado.includes('@')

    return {
      courseId: course.id,
      slug: course.slug,
      title: course.title,
      modules: builtModules,
      progressPercent,
      availableAt: course.availableAt ? course.availableAt.toISOString() : null,
      locked,
      hasCpf,
      hasName,
      tutor: !!course.tutorEnabled,
    }
  }
}
