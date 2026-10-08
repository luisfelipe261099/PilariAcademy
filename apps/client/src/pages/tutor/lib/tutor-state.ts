import type { TutorTurno } from '@pilari/types'

/** O que a esfera está fazendo. A tela inteira deriva daqui: cor, animação, texto de status e o que o toque faz. */
export type FaseTutor = 'pronto' | 'ouvindo' | 'pensando' | 'falando' | 'erro'

export interface EstadoTutor {
  fase: FaseTutor
  historico: TutorTurno[]
  /** Última fala do aluno e da tutora, para as legendas. */
  ultimaPergunta: string
  ultimaResposta: string
  erro: string | null
}

export type EventoTutor =
  | { tipo: 'ouvir' }
  | { tipo: 'pensar'; pergunta?: string }
  | { tipo: 'responder'; pergunta: string; resposta: string }
  | { tipo: 'falou' }
  | { tipo: 'interromper' }
  | { tipo: 'falhar'; mensagem: string }
  | { tipo: 'trocarModulo' }

/** Falas guardadas no navegador para dar contexto à próxima pergunta (o servidor usa as 8 últimas). */
const MAX_HISTORICO = 12

export const estadoInicial: EstadoTutor = { fase: 'pronto', historico: [], ultimaPergunta: '', ultimaResposta: '', erro: null }

export function reduzirTutor(s: EstadoTutor, e: EventoTutor): EstadoTutor {
  switch (e.tipo) {
    case 'ouvir':
      return { ...s, fase: 'ouvindo', erro: null }
    case 'pensar':
      return { ...s, fase: 'pensando', erro: null, ultimaPergunta: e.pergunta ?? s.ultimaPergunta }
    case 'responder': {
      const historico = [...s.historico, { role: 'aluno' as const, text: e.pergunta }, { role: 'tutor' as const, text: e.resposta }].slice(-MAX_HISTORICO)
      return { ...s, fase: 'falando', historico, ultimaPergunta: e.pergunta, ultimaResposta: e.resposta, erro: null }
    }
    case 'falou':
    case 'interromper':
      return { ...s, fase: 'pronto' }
    case 'falhar':
      return { ...s, fase: 'erro', erro: e.mensagem }
    case 'trocarModulo':
      // Outro módulo, outro material: a conversa anterior só confundiria o contexto.
      return { ...estadoInicial }
  }
}

/** Fase depois de um evento, sem precisar do estado atual: os handlers assíncronos atualizam a esfera com isto. */
export function faseApos(e: EventoTutor): FaseTutor {
  switch (e.tipo) {
    case 'ouvir':
      return 'ouvindo'
    case 'pensar':
      return 'pensando'
    case 'responder':
      return 'falando'
    case 'falhar':
      return 'erro'
    default:
      return 'pronto'
  }
}

/** Texto de status embaixo da esfera. */
export function textoDaFase(fase: FaseTutor, erro: string | null): string {
  switch (fase) {
    case 'pronto':
      return 'Toque na esfera e faça sua pergunta'
    case 'ouvindo':
      return 'Estou ouvindo… toque de novo quando terminar'
    case 'pensando':
      return 'Pensando…'
    case 'falando':
      return 'Toque na esfera para interromper'
    case 'erro':
      return erro ?? 'Algo deu errado. Toque para tentar de novo.'
  }
}

export function minutosRestantes(usados: number, limite: number): number {
  return Math.max(0, Math.floor((limite - usados) / 60))
}

export interface UsoDoTutor {
  usadosHoje: number
  limiteDia: number
  usadosMes: number
  limiteMes: number
}

/** Manda o saldo que acaba primeiro: o do dia (30 min) ou a cota do mês (1 h incluída no plano do polo). */
export function saldoDoTutor(u: UsoDoTutor): { minutos: number; rotulo: string } {
  const dia = minutosRestantes(u.usadosHoje, u.limiteDia)
  const mes = minutosRestantes(u.usadosMes, u.limiteMes)
  if (mes < dia) return { minutos: mes, rotulo: mes > 0 ? `${mes} min restantes neste mês` : 'Cota do mês atingida' }
  return { minutos: dia, rotulo: dia > 0 ? `${dia} min restantes hoje` : 'Limite de hoje atingido' }
}
