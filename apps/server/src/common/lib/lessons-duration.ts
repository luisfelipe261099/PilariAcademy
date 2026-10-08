import { eq, inArray, sum } from 'drizzle-orm'
import { lessons, modules } from '../../db/schema'
import type { Database } from '../../db/types'

/**
 * Soma da duração das aulas do curso, em segundos (`lessons.duration_sec` das aulas dos módulos do curso).
 *
 * É a consulta ÚNICA por trás da carga horária que a primeira aprovação congela em `courses.workload_hours`
 * (junto com `certificateWorkloadHours`): o `setStatus` do polo e a aprovação do console da plataforma chamam esta
 * mesma função, para os dois caminhos de aprovação não divergirem. É também a soma que o certificado usa na emissão
 * quando o curso não tem carga definida.
 */
export async function lessonsDurationSec(db: Database, courseId: string): Promise<number> {
  const agg = (await db
    .select({ dur: sum(lessons.durationSec) })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))) as Array<{ dur: string | null }>
  return Number(agg[0]?.dur) || 0
}

/**
 * A mesma soma de `lessonsDurationSec` para vários cursos, numa consulta só (a fila de aprovação mostra a carga que
 * ficará congelada sem fazer uma consulta por linha). Curso sem aula não volta do GROUP BY: quem consulta usa `?? 0`.
 */
export async function lessonsDurationSecByCourse(db: Database, courseIds: string[]): Promise<Map<string, number>> {
  if (courseIds.length === 0) return new Map()
  const rows = (await db
    .select({ courseId: modules.courseId, dur: sum(lessons.durationSec) })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(inArray(modules.courseId, courseIds))
    .groupBy(modules.courseId)) as Array<{ courseId: string; dur: string | null }>
  return new Map(rows.map((r) => [r.courseId, Number(r.dur) || 0]))
}
