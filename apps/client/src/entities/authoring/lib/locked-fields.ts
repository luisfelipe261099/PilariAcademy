import type { UpdateCourseInput } from '../api'

/** Campos impressos no certificado: depois da aprovação, só o Studio Pilari muda (mesma lista do servidor). */
export const CERTIFICATE_LOCKED_KEYS = ['title', 'workloadHours', 'coordinatorName', 'coordinatorRole', 'coordinatorSignaturePath'] as const

export function omitLockedFields(patch: UpdateCourseInput, locked: boolean): UpdateCourseInput {
  if (!locked) return patch
  const copia: UpdateCourseInput = { ...patch }
  for (const k of CERTIFICATE_LOCKED_KEYS) delete copia[k]
  return copia
}

/**
 * Chave do formulário de dados do curso: ele guarda os campos em useState, então só relê o curso quando é remontado.
 * A primeira aprovação muda o curso por baixo dele: o servidor grava a carga horária calculada (quando o polo não
 * declarou uma) e a trava do certificado passa a valer. Sem remontar, o campo da carga continua vazio e o Salvar
 * seguinte manda `workloadHours: null`, que a plataforma (isenta da trava) grava por cima da carga congelada.
 */
export function metaFormKey(c: { id: string; approvedAt: string | null }): string {
  return `${c.id}:${c.approvedAt ?? ''}`
}
