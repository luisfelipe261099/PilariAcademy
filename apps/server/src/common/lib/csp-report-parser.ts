import express from 'express'
import type { RequestHandler } from 'express'

/**
 * Parser dos relatórios de violação de CSP, que chegam com content-type próprio.
 *
 * Devolve um wrapper anônimo de propósito: o Nest só registra o body parser padrão de
 * application/json se não achar na pilha do Express um middleware CHAMADO `jsonParser`
 * (ExpressAdapter.isMiddlewareApplied compara por function.name). Como express.json()
 * devolve uma função chamada `jsonParser` — mesmo restrita a outros content-types —,
 * usá-la direto no app.use() do bootstrap faz o Nest pular o parser padrão e TODO
 * POST/PATCH JSON da API perde o body (grant de matrícula, checkout, webhook do Asaas…).
 */
export function cspReportJsonParser(): RequestHandler {
  const parser = express.json({ type: ['application/csp-report', 'application/reports+json'], limit: '50kb' })
  return (req, res, next) => parser(req, res, next)
}
