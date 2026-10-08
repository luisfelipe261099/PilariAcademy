/// <reference types="jest" />
import type { TenantContext } from '../tenancy/tenant-context'
import { CoursesController } from './courses.controller'

const TENANT = { id: 't-a', isMatriz: false, status: 'active' } as TenantContext

type FakeRes = { set: jest.Mock; status: jest.Mock; send: jest.Mock; redirect: jest.Mock }

function makeRes() {
  const headers: Record<string, string> = {}
  const res: FakeRes = {
    set: jest.fn((k: string, v: string) => {
      headers[k] = v
      return res
    }),
    status: jest.fn(() => res),
    send: jest.fn(() => res),
    redirect: jest.fn(() => res),
  }
  return { res, headers }
}

function make(coverImage: jest.Mock) {
  const coursesService = { coverImage }
  const categoriesService = {}
  return new CoursesController(coursesService as never, categoriesService as never)
}

describe('CoursesController.cover', () => {
  it('imagem raster segura → serve inline com o próprio tipo', async () => {
    const controller = make(jest.fn(async () => ({ kind: 'image', buffer: Buffer.from('\x89PNG'), contentType: 'image/png' })))
    const { res, headers } = makeRes()
    await controller.cover(TENANT, 'c1', res as never)
    expect(headers['Content-Type']).toBe('image/png')
    expect(headers['Content-Disposition']).toBeUndefined()
    expect(res.send).toHaveBeenCalled()
  })

  it('content-type malicioso (text/html) → octet-stream + attachment (anti-XSS)', async () => {
    const controller = make(jest.fn(async () => ({ kind: 'image', buffer: Buffer.from('<script>alert(1)</script>'), contentType: 'text/html' })))
    const { res, headers } = makeRes()
    await controller.cover(TENANT, 'c1', res as never)
    expect(headers['Content-Type']).toBe('application/octet-stream')
    expect(headers['Content-Disposition']).toBe('attachment')
  })

  it('SVG → octet-stream + attachment (SVG executa script)', async () => {
    const controller = make(jest.fn(async () => ({ kind: 'image', buffer: Buffer.from('<svg onload=alert(1)>'), contentType: 'image/svg+xml' })))
    const { res, headers } = makeRes()
    await controller.cover(TENANT, 'c1', res as never)
    expect(headers['Content-Type']).toBe('application/octet-stream')
    expect(headers['Content-Disposition']).toBe('attachment')
  })
})
