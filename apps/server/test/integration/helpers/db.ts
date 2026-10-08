import { createConnection, createPool, type Pool } from 'mysql2/promise'
import { randomBytes } from 'node:crypto'
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2'
import { migrate } from 'drizzle-orm/mysql2/migrator'
import * as schema from '../../../src/db/schema'

export const MIGRATIONS_DIR = path.join(__dirname, '..', '..', '..', 'drizzle')

export interface TestDatabase {
  url: string
  name: string
  pool: Pool
  db: MySql2Database<typeof schema>
  drop(): Promise<void>
}

/**
 * Opt-in explícito para rodar a integração contra outro servidor MySQL-compatível (ex.: TiDB, o banco de produção):
 * INT_DB_SERVER_URL=mysql://usuario:senha@host:4000 (sem banco). Cada suíte cria e apaga o próprio banco `t_…` nele.
 */
const servidorExterno = (): string | undefined => process.env.INT_DB_SERVER_URL?.replace(/\/+$/, '')
const tls = (): string => (servidorExterno() ? '?ssl={"rejectUnauthorized":true}' : '')

function serverUrl(): string {
  const externo = servidorExterno()
  if (externo) return externo
  const port = process.env.MYSQL_TEST_PORT
  if (!port) throw new Error('MYSQL_TEST_PORT ausente: rode pelo jest de integração (globalSetup).')
  return `mysql://${process.env.MYSQL_TEST_USER ?? 'root'}@127.0.0.1:${port}`
}

/** Recusa qualquer banco que não seja o MySQL descartável local. */
export function assertLocal(url: string): void {
  if (servidorExterno() && url.startsWith(servidorExterno()!)) return
  const host = new URL(url).hostname
  if (host !== '127.0.0.1') throw new Error(`Teste de integração recusou banco não local: ${host}`)
}

/** Cria um banco vazio e exclusivo no MySQL de teste. Nunca toca produção. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `t_${randomBytes(6).toString('hex')}`
  const admin = await createConnection(serverUrl() + tls())
  await admin.query(`CREATE DATABASE \`${name}\``)
  await admin.end()
  const url = `${serverUrl()}/${name}${tls()}`
  assertLocal(url)
  const pool = createPool(url)
  const db = drizzle(pool, { schema, mode: 'default' })
  return {
    url,
    name,
    pool,
    db,
    drop: async () => {
      await pool.end()
      const c = await createConnection(serverUrl() + tls())
      await c.query(`DROP DATABASE IF EXISTS \`${name}\``)
      await c.end()
    },
  }
}

/**
 * Quantas transações estão esperando lock agora (os testes de corrida esperam a segunda transação travar antes de soltar a
 * primeira). MySQL: `information_schema.innodb_trx`; TiDB, que não tem essa tabela: `information_schema.DATA_LOCK_WAITS`.
 */
export async function esperasDeLock(pool: Pool): Promise<number> {
  try {
    const [linhas] = await pool.query("SELECT COUNT(*) AS n FROM information_schema.innodb_trx WHERE trx_state = 'LOCK WAIT'")
    return Number((linhas as Array<{ n: number }>)[0].n)
  } catch (err) {
    if ((err as { code?: string }).code !== 'ER_NO_SUCH_TABLE') throw err
    const [linhas] = await pool.query('SELECT COUNT(*) AS n FROM information_schema.DATA_LOCK_WAITS')
    return Number((linhas as Array<{ n: number }>)[0].n)
  }
}

export async function migrateAll(t: TestDatabase, folder: string = MIGRATIONS_DIR): Promise<void> {
  await migrate(t.db, { migrationsFolder: folder })
}

/** Cópia da pasta de migrations com o journal cortado em `maxIdx` (para testar uma migration isolada). */
export async function copyMigrationsUpTo(maxIdx: number): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'migrations-'))
  await cp(MIGRATIONS_DIR, dir, { recursive: true })
  const journalPath = path.join(dir, 'meta', '_journal.json')
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
    entries: Array<{ idx: number }>
  }
  journal.entries = journal.entries.filter((e) => e.idx <= maxIdx)
  await writeFile(journalPath, JSON.stringify(journal, null, 2))
  return dir
}
