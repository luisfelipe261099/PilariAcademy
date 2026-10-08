/// <reference types="jest" />
// Mock chainable do Drizzle ORM para testes unitários.
//
// Design:
//   - `db` (DrizzleMock) NÃO tem `then` — seguro como useValue no Nest
//   - `db.select()`, `db.insert()`, etc. retornam um QueryChain thenable
//   - Aguardar um QueryChain consome o próximo valor da fila FIFO compartilhada
//   - Os métodos do QueryChain chamam os jest.Mock do db para as asserts funcionarem

const CHAIN_METHODS = [
  'select',
  'insert',
  'update',
  'delete',
  'from',
  'where',
  'limit',
  'offset',
  'orderBy',
  'values',
  'set',
  'leftJoin',
  'innerJoin',
  'groupBy',
  'having',
  'returning',
  'for',
  'onDuplicateKeyUpdate',
] as const

type ChainMethod = (typeof CHAIN_METHODS)[number]

export type DrizzleMock = Record<ChainMethod, jest.Mock> & {
  transaction: jest.Mock
  // sem `then` de propósito — mantém o objeto não-thenable para injeção
}

export function createDrizzleMock(): DrizzleMock {
  const queue: unknown[] = []

  const mock = {} as DrizzleMock

  function makeChain(): object {
    const chain: Record<string, unknown> = {
      then(
        onFulfilled?: ((v: unknown) => unknown) | null,
        onRejected?: ((e: unknown) => unknown) | null
      ) {
        const result = queue.length > 0 ? queue.shift() : []
        return Promise.resolve(result).then(onFulfilled as any, onRejected as any)
      },
    }

    for (const method of CHAIN_METHODS) {
      chain[method] = jest.fn((...args: unknown[]) => {
        mock[method](...args)
        return chain
      })
    }

    return chain
  }

  for (const method of CHAIN_METHODS) {
    mock[method] = jest.fn(() => makeChain())
  }

  mock.transaction = jest.fn((cb: (tx: DrizzleMock) => unknown) => cb(mock))
  ;(mock as Record<string, unknown>)._queue = queue

  return mock
}

/** Enfileira um resultado. O próximo `await db.select()…` resolve para esse valor. */
export function withQueryResult<T>(mock: DrizzleMock, result: T): void {
  ;(mock as unknown as Record<string, unknown[]>)._queue.push(result)
}

/** Enfileira vários resultados em ordem, um por chain aguardado. */
export function withQueryResults<T>(mock: DrizzleMock, ...results: T[]): void {
  for (const r of results) withQueryResult(mock, r)
}
