import { BadRequestException } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { lessons, modules } from '../../db/schema'
import type { Database } from '../../db/types'

/**
 * Curso sem aula não vai para análise nem é publicado. O envio do polo (`setStatus`) e a aprovação do console da
 * plataforma usam esta mesma checagem, com a mesma resposta.
 */
export async function assertCourseHasLesson(db: Database, courseId: string): Promise<void> {
  const ls = await db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .limit(1)
  if (ls.length === 0) {
    throw new BadRequestException({
      statusCode: 400,
      code: 'COURSE_WITHOUT_LESSONS',
      message: 'Adicione ao menos uma aula antes de enviar para análise ou publicar.',
    })
  }
}

/**
 * Linhas que um UPDATE atingiu, como o mysql2 informa (`[ResultSetHeader, ...]`). `null` quando o driver não informa:
 * "não sei" não é "nada mudou", e a gravação conta como feita.
 */
export function affectedRows(result: unknown): number | null {
  const header: unknown = Array.isArray(result) ? result[0] : undefined
  const n = (header as { affectedRows?: unknown } | undefined)?.affectedRows
  return typeof n === 'number' ? n : null
}

/**
 * A troca de status grava com `status = <o que foi lido>` no WHERE. Nenhuma linha atingida quer dizer que outra pessoa
 * mudou o curso entre a leitura e a gravação (o instrutor desistiu da análise enquanto o Studio Pilari aprovava, por
 * exemplo): a decisão foi tomada sobre um estado que não existe mais.
 */
export function statusChangedMeanwhile(): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    code: 'INVALID_TRANSITION',
    message: 'O curso mudou de situação enquanto você decidia. Recarregue a página.',
  })
}
