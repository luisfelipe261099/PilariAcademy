import { createHash } from 'node:crypto'

/** O que a aprovação trava no certificado, como a fila mostra ao revisor. */
export interface ReviewFingerprintInput {
  title: string
  /** Carga que o certificado imprime: a definida pelo polo ou, sem ela, a soma das aulas (`certificateWorkloadHours`). */
  workloadHours: number
  coordinatorName: string | null
  coordinatorRole: string | null
  coordinatorSignaturePath: string | null
}

/**
 * Versão do curso que o revisor viu na fila: o hash do que o certificado vai levar (título, carga, coordenador, cargo e
 * assinatura). A fila e a aprovação calculam com esta mesma função; aprovar com um fingerprint que não bate mais é
 * aprovar algo que ninguém conferiu (o polo mudou o título, ou a duração das aulas, quando a carga é calculada).
 *
 * Serializa como lista JSON, e não com um separador: com `a|b` um título com a barra poderia empatar com outra divisão
 * dos campos. 16 hex (64 bits) bastam para distinguir versões do mesmo curso; o hash não é segredo.
 */
export function reviewFingerprint(i: ReviewFingerprintInput): string {
  const dados = JSON.stringify([i.title, i.workloadHours, i.coordinatorName ?? null, i.coordinatorRole ?? null, i.coordinatorSignaturePath ?? null])
  return createHash('sha256').update(dados).digest('hex').slice(0, 16)
}

/** Tamanho máximo da nota no resumo do log (o resumo inteiro cabe em 500, com o título do curso). */
export const AUDIT_NOTE_MAX = 200

/** A nota da devolução ou da retirada no resumo do log: numa linha só e cortada em 200 caracteres, com "…". */
export function auditNote(note: string): string {
  const linha = (note ?? '').replace(/\s+/g, ' ').trim()
  return linha.length <= AUDIT_NOTE_MAX ? linha : `${linha.slice(0, AUDIT_NOTE_MAX - 1).trimEnd()}…`
}
