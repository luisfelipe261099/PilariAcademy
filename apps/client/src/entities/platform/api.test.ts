import { beforeEach, describe, expect, it, vi } from 'vitest'

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }))
vi.mock('@/shared/api/http-client', () => ({ httpClient: http }))

import {
  approveCourse, getPlatformLogs, getReviewQueue, listPlatformTenants, removePlatformTenantDomain, returnCourse, takedownCourse, updatePlatformTenant,
} from './api'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('rotas da fila de aprovação', () => {
  // O servidor recusa a aprovação sem o fingerprint (400): é ele que prova que o revisor viu a versão que está aprovando.
  it('aprovar manda o fingerprint que a fila mostrou', async () => {
    http.post.mockResolvedValue({ data: {} })
    await approveCourse('c1', 'abc123')
    expect(http.post).toHaveBeenCalledWith('/platform/courses/c1/approve', { fingerprint: 'abc123' })
  })

  it('devolver e tirar do ar mandam o motivo', async () => {
    http.post.mockResolvedValue({ data: {} })
    await returnCourse('c1', 'A aula 1 está sem áudio.')
    await takedownCourse('c2', 'Vídeo com direitos autorais.')
    expect(http.post).toHaveBeenNthCalledWith(1, '/platform/courses/c1/return', { note: 'A aula 1 está sem áudio.' })
    expect(http.post).toHaveBeenNthCalledWith(2, '/platform/courses/c2/takedown', { note: 'Vídeo com direitos autorais.' })
  })
})

describe('respostas embrulhadas do servidor', () => {
  it('abre {tenants}, {items} e {logs}', async () => {
    http.get.mockResolvedValueOnce({ data: { tenants: [{ id: 't1' }] } })
    http.get.mockResolvedValueOnce({ data: { items: [{ courseId: 'c1' }] } })
    http.get.mockResolvedValueOnce({ data: { logs: [{ id: 'l1' }] } })
    expect(await listPlatformTenants()).toEqual([{ id: 't1' }])
    expect(await getReviewQueue()).toEqual([{ courseId: 'c1' }])
    expect(await getPlatformLogs()).toEqual([{ id: 'l1' }])
    expect(http.get.mock.calls.map((c) => c[0])).toEqual(['/platform/tenants', '/platform/review-queue', '/platform/logs'])
  })
})

describe('rotas dos polos', () => {
  it('editar o polo é um PATCH com o corpo que a tela montou', async () => {
    http.patch.mockResolvedValue({ data: { id: 't1' } })
    await updatePlatformTenant('t1', { name: 'Polo Norte' })
    expect(http.patch).toHaveBeenCalledWith('/platform/tenants/t1', { name: 'Polo Norte' })
  })

  // Um host de letras, pontos e hífens passa pelo encodeURIComponent sem mudar: o teste não notaria se o código o tirasse.
  // Com a porta colada (o servidor a descarta), o ":" vira %3A, e a URL só sai assim se a codificação existir.
  it('o domínio vai codificado na URL da remoção', async () => {
    http.delete.mockResolvedValue({ data: { id: 't1' } })
    await removePlatformTenantDomain('t1', 'cursos.polo.com.br:8443')
    expect(http.delete).toHaveBeenCalledWith('/platform/tenants/t1/domains/cursos.polo.com.br%3A8443')
  })
})
