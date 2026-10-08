import type { CourseStatus } from '@pilari/types'
import type { AuditService } from '../audit/audit.service'
import { LOCKED_FIELD_LABELS, portugueseList, type LockedField } from './course-status-policy'

/**
 * Mudança em curso já aprovado que vai para o log do polo do curso. O service decide (só curso aprovado entra) e
 * devolve isto; o controller grava, com quem agiu. Depois da aprovação, o que o polo mexe no conteúdo continua livre,
 * mas fica registrado: exclusões, a duração das aulas (de onde sai a carga calculada) e os dados do certificado.
 */
export interface CourseChangeLog {
  courseId: string
  action:
    | 'course.status' | 'course.module-delete' | 'course.lesson-delete' | 'course.question-delete' | 'course.lesson-duration'
    | 'course.locked-fields'
  summary: string
}

/** Situação do curso como o polo lê no log. */
export const COURSE_STATUS_LABELS: Record<CourseStatus, string> = {
  draft: 'rascunho',
  in_review: 'em análise',
  published: 'publicado',
  archived: 'arquivado',
}

interface CursoDoLog {
  id: string
  title: string
}

/** O resumo do log cabe em 500 caracteres: cada nome entra cortado, com "…". */
function trecho(texto: string, max = 120): string {
  const linha = (texto ?? '').replace(/\s+/g, ' ').trim()
  return linha.length <= max ? linha : `${linha.slice(0, max - 1).trimEnd()}…`
}

const prefixo = (c: CursoDoLog): string => `Curso "${trecho(c.title)}":`

/** "45 s", "10 min", "1 h 5 min", "1 h 2 min 5 s". */
export function formatDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const partes = [h ? `${h} h` : '', m ? `${m} min` : '', s ? `${s} s` : ''].filter(Boolean)
  return partes.length ? partes.join(' ') : '0 s'
}

/** Troca de status do curso (vale para qualquer curso, aprovado ou não): "Curso "X": publicado → rascunho". */
export function statusChangedLog(c: CursoDoLog, de: CourseStatus, para: CourseStatus): CourseChangeLog {
  return { courseId: c.id, action: 'course.status', summary: `${prefixo(c)} ${COURSE_STATUS_LABELS[de]} → ${COURSE_STATUS_LABELS[para]}` }
}

export function moduleDeletedLog(c: CursoDoLog, moduleTitle: string): CourseChangeLog {
  return { courseId: c.id, action: 'course.module-delete', summary: `${prefixo(c)} excluiu o módulo "${trecho(moduleTitle)}"` }
}

export function lessonDeletedLog(c: CursoDoLog, lessonTitle: string): CourseChangeLog {
  return { courseId: c.id, action: 'course.lesson-delete', summary: `${prefixo(c)} excluiu a aula "${trecho(lessonTitle)}"` }
}

export function questionDeletedLog(c: CursoDoLog, moduleTitle: string, prompt: string): CourseChangeLog {
  return {
    courseId: c.id,
    action: 'course.question-delete',
    summary: `${prefixo(c)} excluiu a questão "${trecho(prompt, 80)}" da prova do módulo "${trecho(moduleTitle)}"`,
  }
}

export function lessonDurationLog(c: CursoDoLog, lessonTitle: string, de: number, para: number): CourseChangeLog {
  return {
    courseId: c.id,
    action: 'course.lesson-duration',
    summary: `${prefixo(c)} duração da aula "${trecho(lessonTitle)}" de ${formatDuration(de)} → ${formatDuration(para)}`,
  }
}

/** Dados do certificado mudados em curso aprovado (só a plataforma consegue): lista os campos, não os valores. */
export function lockedFieldsLog(c: CursoDoLog, fields: LockedField[]): CourseChangeLog {
  return {
    courseId: c.id,
    action: 'course.locked-fields',
    summary: `${prefixo(c)} o Studio Pilari alterou ${portugueseList(fields.map((f) => LOCKED_FIELD_LABELS[f]))}`,
  }
}

/** Grava no log do polo a mudança que o service devolveu; nada quando ele devolveu `null` (curso nunca aprovado). */
export function auditCourseChange(
  audit: Pick<AuditService, 'log'>, quem: { uid: string; email?: string | null }, tenantId: string, log: CourseChangeLog | null
): void {
  if (!log) return
  audit.log({ tenantId, actorUid: quem.uid, actorEmail: quem.email ?? null, action: log.action, summary: log.summary, targetType: 'course', targetId: log.courseId })
}
