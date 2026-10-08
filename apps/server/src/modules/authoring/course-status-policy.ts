import type { CourseStatus } from '@pilari/types'

export interface StatusChangeInput {
  from: CourseStatus
  to: CourseStatus
  /** Primeira aprovação. Curso aprovado pode voltar ao ar pelo admin do polo sem nova análise. */
  approvedAt: Date | null
  /**
   * Nota do Studio Pilari (devolução ou retirada do ar). Só some quando o curso é aprovado de novo
   * (`clearReviewNote`); enquanto existir, o polo não republica sem nova análise.
   */
  reviewNote: string | null
  /** Admin DESTE polo (inclui admin da plataforma). */
  isTenantAdmin: boolean
  isPlatformAdmin: boolean
  isMatriz: boolean
}

export type StatusChangeDecision =
  | {
      ok: true
      /** Grava `submitted_at` (envio para análise). */
      markSubmitted: boolean
      /** Primeira aprovação: grava `approved_at` e `approved_by`. */
      markApproved: boolean
      /** Apaga a nota do Studio Pilari: só a aprovação (plataforma, ou admin da matriz na matriz) faz isso. */
      clearReviewNote: boolean
    }
  | { ok: false; status: 400 | 403; code: 'INVALID_TRANSITION' | 'APPROVAL_REQUIRED' | 'FORBIDDEN'; message: string }

const ok = (marcas: { markSubmitted?: boolean; markApproved?: boolean; clearReviewNote?: boolean } = {}): StatusChangeDecision => ({
  ok: true, markSubmitted: false, markApproved: false, clearReviewNote: false, ...marcas,
})
const nega = (status: 400 | 403, code: 'INVALID_TRANSITION' | 'APPROVAL_REQUIRED' | 'FORBIDDEN', message: string): StatusChangeDecision => ({
  ok: false, status, code, message,
})

/**
 * Transições do curso. A primeira publicação de curso de polo exige a aprovação
 * do Studio Pilari (admin da plataforma). Na matriz, o admin publica direto.
 *
 * A nota do Studio Pilari (`reviewNote`) é decidida aqui, e só em um lugar: ela é apagada UNICAMENTE
 * quando o curso é aprovado por quem pode aprovar. Enviar para análise e desistir (e tirar do ar, e
 * arquivar) não a tocam. Se a nota sumisse num desses passos, a cadeia análise, desistência,
 * republicação devolveria ao ar, sem nova análise, o curso que o Studio Pilari tirou.
 */
export function decideStatusChange(i: StatusChangeInput): StatusChangeDecision {
  if (i.from === i.to) return ok()
  const podeAprovar = i.isPlatformAdmin || (i.isMatriz && i.isTenantAdmin)
  switch (i.to) {
    case 'in_review':
      return i.from === 'draft' ? ok({ markSubmitted: true }) : nega(400, 'INVALID_TRANSITION', 'Só um curso em rascunho pode ser enviado para análise.')
    case 'draft':
      // Voltar para rascunho é livre para quem edita o curso (regra atual da matriz):
      // desistir da análise ou tirar do ar não expõe nada.
      return ok()
    case 'published':
      if (podeAprovar) return ok({ markApproved: i.approvedAt == null, clearReviewNote: true })
      if (i.isTenantAdmin && i.approvedAt != null && i.reviewNote == null && i.from !== 'in_review') return ok()
      // Já enviado: mandar enviar para análise de novo não faz sentido; falta só a decisão do Studio Pilari.
      if (i.from === 'in_review') return nega(403, 'APPROVAL_REQUIRED', 'Este curso está em análise pelo Studio Pilari. Aguarde a aprovação.')
      if (i.reviewNote != null) {
        return nega(403, 'APPROVAL_REQUIRED', 'O Studio Pilari pediu ajustes neste curso. Corrija o que foi apontado e envie para análise.')
      }
      return nega(403, 'APPROVAL_REQUIRED', 'A publicação deste curso depende da aprovação do Studio Pilari. Envie o curso para análise.')
    case 'archived':
      return i.isTenantAdmin ? ok() : nega(403, 'FORBIDDEN', 'Só o admin do polo arquiva um curso.')
  }
}

/** Dados impressos no certificado: depois da primeira aprovação, só a plataforma muda. */
export const CERTIFICATE_LOCKED_FIELDS = ['title', 'workloadHours', 'coordinatorName', 'coordinatorRole', 'coordinatorSignaturePath'] as const
export type LockedField = (typeof CERTIFICATE_LOCKED_FIELDS)[number]

/** Rótulos com artigo, para entrar numa frase: "o título e a carga horária só mudam...". */
export const LOCKED_FIELD_LABELS: Record<LockedField, string> = {
  title: 'o título',
  workloadHours: 'a carga horária',
  coordinatorName: 'o coordenador',
  coordinatorRole: 'o cargo do coordenador',
  coordinatorSignaturePath: 'a assinatura do coordenador',
}

/** "a", "a e b", "a, b e c": lista em português, sem vírgula antes do "e". */
export function portugueseList(partes: string[]): string {
  if (partes.length < 2) return partes.join('')
  return `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`
}

/** Texto do 403 `CERTIFICATE_FIELDS_LOCKED`, com o verbo concordando com a lista (um campo "muda", vários "mudam"). */
export function lockedFieldsMessage(fields: LockedField[]): string {
  const lista = portugueseList(fields.map((f) => LOCKED_FIELD_LABELS[f]))
  return `Depois da aprovação, ${lista} só ${fields.length === 1 ? 'muda' : 'mudam'} pelo Studio Pilari. Peça a alteração ao Studio Pilari.`
}

/** Campos travados que o patch MUDA de fato. O editor manda o objeto inteiro: valor igual passa. */
export function lockedFieldChanges(
  current: { approvedAt: Date | null } & Partial<Record<LockedField, unknown>>,
  patch: Partial<Record<LockedField, unknown>>,
  isPlatformAdmin: boolean
): LockedField[] {
  if (isPlatformAdmin || current.approvedAt == null) return []
  return CERTIFICATE_LOCKED_FIELDS.filter((f) => patch[f] !== undefined && (patch[f] ?? null) !== (current[f] ?? null))
}
