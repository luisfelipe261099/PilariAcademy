/** Profundidade máxima da cadeia de `cause` — corta ciclo sem precisar de Set. */
const MAX_CAUSE_DEPTH = 5

/**
 * O erro é violação de índice único (ER_DUP_ENTRY)?
 *
 * A partir do drizzle-orm 0.44 o driver lança `DrizzleQueryError`, que EMBRULHA o erro
 * do MySQL em `cause`. Testar só `err.code` devolve undefined em produção e transforma
 * um 409 previsto ("já tem compra pendente") num 500 genérico. Por isso percorremos a
 * cadeia de causas em vez de olhar apenas a raiz.
 */
export function isDuplicateEntry(err: unknown): boolean {
  let current = err
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (!current || typeof current !== 'object') return false
    if ((current as { code?: unknown }).code === 'ER_DUP_ENTRY') return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}
