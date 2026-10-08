import express from 'express'
import type { RequestHandler } from 'express'

/** POST /api/me/courses/:slug/tutor/ask leva o áudio da pergunta em base64 (até ~2 MB). */
const ROTA_PERGUNTA = /^\/api\/me\/courses\/[^/]+\/tutor\/ask\/?$/

/**
 * Leitor JSON de até 4 MB só para a rota da pergunta do tutor; o resto da API fica com o limite padrão do Nest.
 * Registrado antes do init, como o cspReportJsonParser. O body-parser marca a requisição como lida, então o leitor
 * padrão do Nest pula esta rota. NUNCA chamar a função de "jsonParser": o Nest deixaria de registrar o padrão.
 */
export function tutorAudioJsonParser(): RequestHandler {
  const leitor = express.json({ limit: '4mb' })
  return (req, res, next) => {
    if (req.method === 'POST' && ROTA_PERGUNTA.test(req.path)) return leitor(req, res, next)
    next()
  }
}
