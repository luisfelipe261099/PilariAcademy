/// <reference types="jest" />
import { isDuplicateEntry } from './db-errors'

describe('isDuplicateEntry', () => {
  it('reconhece o erro cru do driver (code na raiz)', () => {
    expect(isDuplicateEntry(Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }))).toBe(true)
  })

  it('reconhece o erro EMBRULHADO pelo Drizzle (code em .cause)', () => {
    // A partir do drizzle 0.44 o driver lança DrizzleQueryError e o erro do MySQL
    // vai para `cause`. Testar só `err.code` devolve undefined e o 409 vira 500.
    const wrapped = new Error('Failed query: insert into `enrollments` ...')
    ;(wrapped as { cause?: unknown }).cause = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' })
    expect(isDuplicateEntry(wrapped)).toBe(true)
  })

  it('atravessa mais de um nível de cause', () => {
    const inner = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' })
    const mid = new Error('meio')
    ;(mid as { cause?: unknown }).cause = inner
    const outer = new Error('fora')
    ;(outer as { cause?: unknown }).cause = mid
    expect(isDuplicateEntry(outer)).toBe(true)
  })

  it('não confunde outro erro de banco com duplicidade', () => {
    const wrapped = new Error('Failed query')
    ;(wrapped as { cause?: unknown }).cause = Object.assign(new Error('deadlock'), { code: 'ER_LOCK_DEADLOCK' })
    expect(isDuplicateEntry(wrapped)).toBe(false)
  })

  it('aguenta null, string e ciclo em cause sem estourar', () => {
    expect(isDuplicateEntry(null)).toBe(false)
    expect(isDuplicateEntry('ER_DUP_ENTRY')).toBe(false)
    const a = new Error('a')
    const b = new Error('b')
    ;(a as { cause?: unknown }).cause = b
    ;(b as { cause?: unknown }).cause = a
    expect(isDuplicateEntry(a)).toBe(false)
  })
})
