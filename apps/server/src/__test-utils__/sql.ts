/// <reference types="jest" />
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import type { SQL } from 'drizzle-orm'

const dialect = new MySqlDialect()

/**
 * Renderiza a condição passada ao `where()` do mock. O mock do Drizzle não executa SQL, então
 * esta é a forma de provar, num teste unitário, que a consulta filtra pelo polo.
 * Ex.: expect(renderSql(db.where.mock.calls[0][0]).sql).toContain('`courses`.`tenant_id` = ?')
 */
export function renderSql(cond: unknown): { sql: string; params: unknown[] } {
  if (!cond) return { sql: '', params: [] }
  const q = dialect.sqlToQuery(cond as SQL)
  return { sql: q.sql, params: q.params }
}

/** Todas as condições passadas ao `where()` do mock, na ordem das chamadas. */
export function allWheres(whereMock: jest.Mock): Array<{ sql: string; params: unknown[] }> {
  return whereMock.mock.calls.map((c: unknown[]) => renderSql(c[0]))
}
