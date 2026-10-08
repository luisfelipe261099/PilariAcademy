import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MutationObserver, QueryClient } from '@tanstack/react-query'

const api = vi.hoisted(() => ({ approveCourse: vi.fn(), returnCourse: vi.fn(), takedownCourse: vi.fn() }))
vi.mock('./api', () => api)
// Sem rede e sem Firebase: o queries.ts importa a chave da lista de cursos do admin, que importa o cliente HTTP.
vi.mock('@/shared/api/http-client', () => ({ httpClient: {} }))

import { ADMIN_COURSES_KEY } from '@/entities/admin-dashboard'
import { PLATFORM_TENANTS_KEY, REVIEW_QUEUE_KEY, platformTenantKey, reviewMutationOptions, takedownMutationOptions } from './queries'

const erroDaApi = (status: number, code: string, message: string) => ({ response: { status, data: { statusCode: status, code, message } } })

function monta() {
  const qc = new QueryClient()
  const invalidar = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()
  const { approve, giveBack } = reviewMutationOptions(qc)
  return { invalidar, aprovar: new MutationObserver(qc, approve), devolver: new MutationObserver(qc, giveBack) }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('aprovação do curso', () => {
  it('manda ao servidor o curso e o fingerprint que a fila mostrou', async () => {
    api.approveCourse.mockResolvedValue(undefined)
    const { aprovar } = monta()
    await aprovar.mutate({ courseId: 'c1', fingerprint: 'abc123' })
    expect(api.approveCourse).toHaveBeenCalledWith('c1', 'abc123')
  })

  it('aprovado: a fila e a lista de polos (contagem em análise) recarregam', async () => {
    api.approveCourse.mockResolvedValue(undefined)
    const { aprovar, invalidar } = monta()
    await aprovar.mutate({ courseId: 'c1', fingerprint: 'abc123' })
    expect(invalidar).toHaveBeenCalledWith({ queryKey: REVIEW_QUEUE_KEY })
    expect(invalidar).toHaveBeenCalledWith({ queryKey: PLATFORM_TENANTS_KEY })
  })

  // 409: o polo mexeu no curso depois que a fila foi carregada. A fila recarrega para o revisor conferir o que mudou, e o
  // erro continua subindo para a tela mostrar a mensagem do servidor.
  it('409 COURSE_CHANGED: recarrega a fila e devolve o erro para a tela mostrar a mensagem', async () => {
    const erro = erroDaApi(409, 'COURSE_CHANGED', 'O curso mudou desde que a fila foi carregada. Recarregue e confira antes de aprovar.')
    api.approveCourse.mockRejectedValue(erro)
    const { aprovar, invalidar } = monta()
    await expect(aprovar.mutate({ courseId: 'c1', fingerprint: 'velho' })).rejects.toBe(erro)
    expect(invalidar).toHaveBeenCalledTimes(1)
    expect(invalidar).toHaveBeenCalledWith({ queryKey: REVIEW_QUEUE_KEY })
  })

  // O curso que saiu da análise sumiria da fila junto com a explicação: o cartão fica, com a mensagem, até o revisor atualizar.
  it.each([
    ['COURSE_WITHOUT_LESSONS', 'Adicione ao menos uma aula antes de enviar para análise ou publicar.'],
    ['INVALID_TRANSITION', 'O curso mudou de situação enquanto você decidia. Recarregue a página.'],
  ])('400 %s: não recarrega a fila sozinha, o cartão fica com a mensagem', async (code, message) => {
    const erro = erroDaApi(400, code, message)
    api.approveCourse.mockRejectedValue(erro)
    const { aprovar, invalidar } = monta()
    await expect(aprovar.mutate({ courseId: 'c1', fingerprint: 'abc123' })).rejects.toBe(erro)
    expect(invalidar).not.toHaveBeenCalled()
  })

  it('erro de rede (sem resposta): não recarrega nada', async () => {
    api.approveCourse.mockRejectedValue(new Error('Network Error'))
    const { aprovar, invalidar } = monta()
    await expect(aprovar.mutate({ courseId: 'c1', fingerprint: 'abc123' })).rejects.toThrow('Network Error')
    expect(invalidar).not.toHaveBeenCalled()
  })
})

describe('devolução do curso', () => {
  it('manda o motivo e, devolvido, recarrega a fila e a lista de polos', async () => {
    api.returnCourse.mockResolvedValue(undefined)
    const { devolver, invalidar } = monta()
    await devolver.mutate({ courseId: 'c1', note: 'A aula 1 está sem áudio.' })
    expect(api.returnCourse).toHaveBeenCalledWith('c1', 'A aula 1 está sem áudio.')
    expect(invalidar).toHaveBeenCalledWith({ queryKey: REVIEW_QUEUE_KEY })
    expect(invalidar).toHaveBeenCalledWith({ queryKey: PLATFORM_TENANTS_KEY })
  })
})

describe('tirar do ar', () => {
  /** Cliente de verdade, com as consultas já no cache: `isInvalidated` mostra o que a mutação realmente marcou como velho. */
  function comCache() {
    const qc = new QueryClient()
    const chaves = [ADMIN_COURSES_KEY, PLATFORM_TENANTS_KEY, platformTenantKey('t1'), platformTenantKey('t2'), REVIEW_QUEUE_KEY] as const
    for (const chave of chaves) qc.setQueryData(chave, [])
    const velha = (chave: readonly unknown[]) => qc.getQueryState(chave)?.isInvalidated
    return { qc, velha }
  }

  it('manda o curso e o motivo ao servidor', async () => {
    api.takedownCourse.mockResolvedValue(undefined)
    const { qc } = comCache()
    await new MutationObserver(qc, takedownMutationOptions(qc)).mutate({ courseId: 'c1', note: 'Vídeo com direitos autorais.' })
    expect(api.takedownCourse).toHaveBeenCalledWith('c1', 'Vídeo com direitos autorais.')
  })

  // A lista de polos e o detalhe de cada polo mostram "Publicados": o curso que saiu do ar muda a contagem.
  it('tirado do ar: a lista de cursos, a lista de polos e o detalhe de todo polo ficam velhos', async () => {
    api.takedownCourse.mockResolvedValue(undefined)
    const { qc, velha } = comCache()
    await new MutationObserver(qc, takedownMutationOptions(qc)).mutate({ courseId: 'c1', note: 'Motivo' })
    expect(velha(ADMIN_COURSES_KEY)).toBe(true)
    expect(velha(PLATFORM_TENANTS_KEY)).toBe(true)
    expect(velha(platformTenantKey('t1'))).toBe(true)
    expect(velha(platformTenantKey('t2'))).toBe(true)
    expect(velha(REVIEW_QUEUE_KEY)).toBe(false) // controle: a fila de análise não muda com a retirada
  })

  it('o servidor recusou: nada é recarregado e o erro sobe para a tela', async () => {
    const erro = erroDaApi(400, 'INVALID_TRANSITION', 'Só um curso publicado pode ser tirado do ar.')
    api.takedownCourse.mockRejectedValue(erro)
    const { qc, velha } = comCache()
    await expect(new MutationObserver(qc, takedownMutationOptions(qc)).mutate({ courseId: 'c1', note: 'Motivo' })).rejects.toBe(erro)
    expect(velha(ADMIN_COURSES_KEY)).toBe(false)
    expect(velha(PLATFORM_TENANTS_KEY)).toBe(false)
  })
})
