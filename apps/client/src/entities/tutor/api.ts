import type { TutorInfo, TutorResposta, TutorTurno } from '@pilari/types'
import { httpClient } from '@/shared/api/http-client'
import { firebaseAuth } from '@/shared/config/firebase'

export async function getTutorInfo(slug: string): Promise<TutorInfo> {
  const { data } = await httpClient.get<TutorInfo>(`/me/courses/${slug}/tutor`)
  return data
}

export interface PerguntaTutor {
  moduleId: string
  audioWavBase64?: string
  texto?: string
  historico: TutorTurno[]
}

export async function perguntarTutor(slug: string, pergunta: PerguntaTutor): Promise<TutorResposta> {
  const { data } = await httpClient.post<TutorResposta>(`/me/courses/${slug}/tutor/ask`, pergunta)
  return data
}

/**
 * Voz da resposta em fluxo (PCM 16 bits 24 kHz). Usa fetch, não axios: o axios do navegador só entrega a resposta
 * inteira, e o áudio precisa começar a tocar no primeiro pedaço.
 */
export async function falarTutor(slug: string, texto: string, signal: AbortSignal): Promise<Response> {
  const token = await firebaseAuth?.currentUser?.getIdToken()
  const base = import.meta.env.VITE_API_URL ?? '/api'
  const r = await fetch(`${base}/me/courses/${slug}/tutor/speak`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ texto }),
    signal,
  })
  if (!r.ok) {
    const corpo = (await r.json().catch(() => null)) as { message?: string } | null
    throw new Error(corpo?.message ?? 'Não consegui falar a resposta agora.')
  }
  return r
}

/** Mensagem legível de um erro da API do tutor (o servidor já manda em português). */
export function mensagemDoErro(error: unknown, padrao = 'Algo deu errado. Toque na esfera para tentar de novo.'): string {
  const msg = (error as { response?: { data?: { message?: string | string[] } } } | null)?.response?.data?.message
  if (Array.isArray(msg)) return msg[0] ?? padrao
  if (typeof msg === 'string' && msg) return msg
  if (error instanceof Error && error.message && !/status code|Network Error/i.test(error.message)) return error.message
  return padrao
}
