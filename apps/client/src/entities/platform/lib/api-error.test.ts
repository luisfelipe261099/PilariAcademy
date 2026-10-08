import { describe, expect, it } from 'vitest'
import { apiErrorCode } from './api-error'

const resposta = (data: unknown) => ({ response: { status: 409, data } })

describe('apiErrorCode', () => {
  it('lê o code estável do corpo da resposta', () => {
    expect(apiErrorCode(resposta({ statusCode: 409, code: 'COURSE_CHANGED', message: 'x' }))).toBe('COURSE_CHANGED')
    expect(apiErrorCode(resposta({ statusCode: 404, code: 'TENANT_NOT_FOUND', message: 'Polo não encontrado.' }))).toBe('TENANT_NOT_FOUND')
  })
  it('resposta sem code (ex.: 409 do endereço repetido), sem corpo ou erro de rede: null', () => {
    expect(apiErrorCode(resposta({ statusCode: 409, message: 'Já existe um polo com este endereço.' }))).toBeNull()
    expect(apiErrorCode(resposta(undefined))).toBeNull()
    expect(apiErrorCode(new Error('Network Error'))).toBeNull()
    expect(apiErrorCode(null)).toBeNull()
    expect(apiErrorCode(undefined)).toBeNull()
  })
  it('code que não é texto não vale', () => {
    expect(apiErrorCode(resposta({ code: 409 }))).toBeNull()
  })
})
