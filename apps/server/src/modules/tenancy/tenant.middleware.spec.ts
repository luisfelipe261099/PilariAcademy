import type { NextFunction, Response } from 'express'
import { tenantMiddleware } from './tenant.middleware'
import type { TenantsService } from './tenants.service'
import type { RequestWithTenant } from './tenant-request'

function res() {
  const r = { statusCode: 200, body: undefined as unknown, type: jest.fn(), status: jest.fn(), json: jest.fn(), send: jest.fn() }
  r.status.mockImplementation((c: number) => { r.statusCode = c; return r })
  r.type.mockReturnValue(r)
  r.json.mockImplementation((b: unknown) => { r.body = b; return r })
  r.send.mockImplementation((b: unknown) => { r.body = b; return r })
  return r
}
const flush = () => new Promise((resolve) => setImmediate(resolve))

describe('tenantMiddleware', () => {
  const tenant = { id: 't-a', slug: 'polo-a' }

  it('grava req.tenant e segue quando o host resolve', async () => {
    const svc = { resolveHost: jest.fn().mockResolvedValue(tenant) } as unknown as TenantsService
    const req = { headers: { host: 'polo-a.cursos.studiopilari.com.br' }, path: '/api/courses' } as unknown as RequestWithTenant
    const next = jest.fn()
    tenantMiddleware(svc, { notFoundHtml: '<h1>404</h1>' })(req, res() as unknown as Response, next as NextFunction)
    await flush()
    expect(req.tenant).toBe(tenant)
    expect(next).toHaveBeenCalledWith()
  })

  it('API de host desconhecido responde 404 TENANT_NOT_FOUND', async () => {
    const svc = { resolveHost: jest.fn().mockResolvedValue(null) } as unknown as TenantsService
    const r = res()
    const next = jest.fn()
    tenantMiddleware(svc, { notFoundHtml: '<h1>404</h1>' })({ headers: { host: 'x.com' }, path: '/api/courses' } as never, r as never, next)
    await flush()
    expect(r.statusCode).toBe(404)
    expect(r.body).toMatchObject({ code: 'TENANT_NOT_FOUND' })
    expect(next).not.toHaveBeenCalled()
  })

  it('site de host desconhecido responde a página 404', async () => {
    const svc = { resolveHost: jest.fn().mockResolvedValue(null) } as unknown as TenantsService
    const r = res()
    tenantMiddleware(svc, { notFoundHtml: '<h1>404</h1>' })({ headers: { host: 'x.com' }, path: '/curso/x' } as never, r as never, jest.fn())
    await flush()
    expect(r.statusCode).toBe(404)
    expect(r.body).toBe('<h1>404</h1>')
  })

  it('erro ao resolver vai para o next(err)', async () => {
    const erro = new Error('banco fora')
    const svc = { resolveHost: jest.fn().mockRejectedValue(erro) } as unknown as TenantsService
    const next = jest.fn()
    tenantMiddleware(svc, { notFoundHtml: '' })({ headers: {}, path: '/' } as never, res() as never, next)
    await flush()
    expect(next).toHaveBeenCalledWith(erro)
  })
})
