import type { NextFunction, Request, RequestHandler, Response } from 'express'
import type { TenantsService } from './tenants.service'
import type { RequestWithTenant } from './tenant-request'

/**
 * Resolve o polo pelo header Host ANTES de guards, estáticos e fallback do SPA. Host que não
 * pertence a nenhum polo para aqui: 404 em JSON na API, página 404 no site. Nunca cai na matriz.
 */
export function tenantMiddleware(tenants: TenantsService, opts: { notFoundHtml: string }): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    tenants
      .resolveHost(req.headers.host)
      .then((tenant) => {
        if (!tenant) {
          if (req.path.startsWith('/api')) {
            res.status(404).json({ statusCode: 404, code: 'TENANT_NOT_FOUND', message: 'Polo não encontrado.' })
            return
          }
          res.status(404).type('html').send(opts.notFoundHtml)
          return
        }
        ;(req as RequestWithTenant).tenant = tenant
        next()
      })
      .catch(next)
  }
}
