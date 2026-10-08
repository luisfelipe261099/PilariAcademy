/**
 * Decide se o boot pode aplicar migrations. Em produção, sempre. Fora dela, só num banco
 * local (localhost, 127.0.0.1, ::1) ou com ALLOW_REMOTE_MIGRATIONS=1 explícito.
 *
 * Motivo: o .env padrão de desenvolvimento aponta para o banco de PRODUÇÃO, e o DatabaseModule
 * aplica migrations no boot. Subir o servidor local para testar uma migration nova não pode
 * alterar produção.
 */
export interface MigrationEnv {
  NODE_ENV?: string
  DATABASE_URL?: string
  ALLOW_REMOTE_MIGRATIONS?: string
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function hostOf(url?: string): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.toLowerCase() || null
  } catch {
    return null
  }
}

export function shouldRunMigrations(env: MigrationEnv): { run: boolean; reason: string } {
  if (env.NODE_ENV === 'production') return { run: true, reason: 'produção' }
  if (env.ALLOW_REMOTE_MIGRATIONS === '1') return { run: true, reason: 'ALLOW_REMOTE_MIGRATIONS=1' }
  const host = hostOf(env.DATABASE_URL)
  if (host && LOCAL_HOSTS.has(host)) return { run: true, reason: `banco local (${host})` }
  return { run: false, reason: `banco remoto (${host ?? 'desconhecido'}) fora de produção` }
}

/** Última migration do journal do drizzle: o `when` que o migrator grava em `__drizzle_migrations.created_at`. */
export function ultimaMigrationDoJournal(journal: { entries: ReadonlyArray<{ when: number }> }): number {
  if (!journal.entries.length) throw new Error('Journal de migrations vazio.')
  return Math.max(...journal.entries.map((e) => e.when))
}

/**
 * O banco ainda não tem a última migration do código. Em produção isso impede a subida: o código novo não atende
 * sobre o schema antigo, e o Cloud Run mantém a revisão anterior com o tráfego.
 */
export function migrationsPendentes(ultimaDoJournal: number, ultimaNoBanco: number | string | null | undefined): boolean {
  return ultimaNoBanco == null || Number(ultimaNoBanco) < ultimaDoJournal
}
