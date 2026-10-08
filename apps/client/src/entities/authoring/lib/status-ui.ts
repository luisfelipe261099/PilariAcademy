import type { CourseStatus } from '@pilari/types'

export type HintPart = string | { strong: string }

export interface StatusUiInput {
  status: CourseStatus
  approvedAt: string | null
  reviewNote: string | null
  /** Admin do polo do endereço (o admin da plataforma também é). */
  isTenantAdmin: boolean
  isPlatformAdmin: boolean
  isMatriz: boolean
}

export interface StatusAction {
  to: CourseStatus
  label: string
  primary: boolean
}

/** Mesma regra do servidor: quem publica sem a análise do Studio Pilari. */
function podeAprovar(i: StatusUiInput): boolean {
  return i.isPlatformAdmin || (i.isMatriz && i.isTenantAdmin)
}

/** Admin do polo recoloca no ar curso já aprovado, sem nota pendente do Studio Pilari. */
function podeRepublicar(i: StatusUiInput): boolean {
  return i.isTenantAdmin && i.approvedAt !== null && i.reviewNote === null
}

/** Botão de status e texto de apoio do editor do curso. Na matriz, iguais aos de antes do multi-polo. */
export function courseStatusUi(i: StatusUiInput): { action: StatusAction; hint: HintPart[] | null } {
  if (i.status === 'published') return { action: { to: 'draft', label: 'Despublicar', primary: false }, hint: null }
  if (i.status === 'in_review') {
    return {
      action: { to: 'draft', label: 'Cancelar revisão', primary: false },
      hint: [i.isMatriz ? 'Aguardando aprovação de um admin para ser publicado.' : 'Aguardando a aprovação do Studio Pilari.'],
    }
  }
  if (podeAprovar(i)) {
    return {
      action: { to: 'published', label: 'Publicar', primary: true },
      hint: i.status === 'draft' ? ['Rascunho não aparece no catálogo. Clique em ', { strong: 'Publicar' }, ' quando o curso estiver pronto.'] : null,
    }
  }
  if (podeRepublicar(i)) {
    return {
      action: { to: 'published', label: 'Publicar', primary: true },
      hint:
        i.status === 'draft'
          ? ['Rascunho não aparece no catálogo. Este curso já foi aprovado pelo Studio Pilari: clique em ', { strong: 'Publicar' }, ' para colocá-lo de volta no ar.']
          : null,
    }
  }
  if (i.status === 'archived') return { action: { to: 'draft', label: 'Voltar para rascunho', primary: false }, hint: null }
  return {
    action: { to: 'in_review', label: 'Enviar para revisão', primary: true },
    hint: [
      'Rascunho não aparece no catálogo. Quando o curso estiver pronto, clique em ',
      { strong: 'Enviar para revisão' },
      i.isMatriz ? ' — um admin aprova a publicação.' : ': a equipe do Studio Pilari aprova a publicação.',
    ],
  }
}

/** Ações da linha do curso na tela Cursos do admin. Na matriz, iguais às de antes. */
export function adminCourseActions(i: StatusUiInput): StatusAction[] {
  if (i.status === 'published') return [{ to: 'draft', label: 'Despublicar', primary: true }]
  if (i.status === 'in_review') {
    const devolver: StatusAction = { to: 'draft', label: 'Devolver p/ rascunho', primary: false }
    return podeAprovar(i) ? [{ to: 'published', label: 'Aprovar e publicar', primary: true }, devolver] : [devolver]
  }
  return podeAprovar(i) || podeRepublicar(i) ? [{ to: 'published', label: 'Publicar', primary: true }] : []
}

/**
 * Botão "Excluir curso" da linha. Curso que já foi aprovado só a plataforma exclui (o polo tira do ar ou
 * arquiva); o admin da matriz é da plataforma, então na matriz o botão continua como antes. Matrícula e
 * certificado também travam a exclusão, mas o client não os conhece: o servidor recusa com 409
 * COURSE_HAS_HISTORY e a tela mostra a mensagem dele.
 */
export function canDeleteCourse(i: Pick<StatusUiInput, 'approvedAt' | 'isPlatformAdmin'>): boolean {
  // `!approvedAt` e não `=== null`: campo ausente (servidor antigo) conta como nunca aprovado, e o servidor decide.
  return i.isPlatformAdmin || !i.approvedAt
}

/**
 * "Tirar do ar (Studio Pilari)": a ação da plataforma sobre o curso PUBLICADO de um polo (a nota que ela grava o polo lê, e
 * o polo só volta com nova análise). É da plataforma no endereço de um polo. Na matriz o botão não aparece: todo admin
 * da matriz é da plataforma e já tem "Despublicar" no mesmo curso, então ele só apareceria em dobro.
 */
export function canTakedownCourse(i: Pick<StatusUiInput, 'status' | 'isPlatformAdmin' | 'isMatriz'>): boolean {
  return i.status === 'published' && i.isPlatformAdmin && !i.isMatriz
}
