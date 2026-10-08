import { Module, Global, Inject, OnModuleInit, Logger } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/mysql2'
import { migrate } from 'drizzle-orm/mysql2/migrator'
import { createPool } from 'mysql2/promise'
import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import * as schema from './schema'
import { migrationsPendentes, shouldRunMigrations, ultimaMigrationDoJournal } from './migration-guard'
import type { Database } from './types'

/**
 * O banco de produção é TiDB, que não tem lock compartilhado: `SELECT … FOR SHARE` (usado para a exclusão de curso não
 * correr contra a emissão de certificado) dá erro. Com `tidb_enable_shared_lock_promotion` o FOR SHARE vira FOR UPDATE,
 * um lock mais forte: a garantia continua. (O `tidb_enable_noop_functions` faria o lock virar nada — não serve.)
 */
export function ehTiDB(databaseUrl: string, engine = process.env.DB_ENGINE): boolean {
  if (engine === 'tidb') return true
  try {
    return /(^|\.)tidbcloud\.com$/i.test(new URL(databaseUrl).hostname)
  } catch {
    return false
  }
}

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: 'DB_CLIENT',
      useFactory: (configService: ConfigService) => {
        const databaseUrl = configService.get<string>('DATABASE_URL')
        if (!databaseUrl) {
          throw new Error('DATABASE_URL não configurada')
        }
        const pool = createPool(databaseUrl)
        // Enfileirado na criação de cada conexão: roda antes de qualquer consulta do app nela.
        if (ehTiDB(databaseUrl)) pool.on('connection', (conn) => void conn.query('SET SESSION tidb_enable_shared_lock_promotion = ON'))
        return drizzle(pool, { schema, mode: 'default' })
      },
      inject: [ConfigService],
    },
  ],
  exports: ['DB_CLIENT'],
})
export class DatabaseModule implements OnModuleInit {
  private readonly logger = new Logger(DatabaseModule.name)

  constructor(@Inject('DB_CLIENT') private readonly db: Database) {}

  async onModuleInit(): Promise<void> {
    const decision = shouldRunMigrations(process.env)
    if (!decision.run) {
      this.logger.warn(
        `Migrations NÃO aplicadas no boot: ${decision.reason}. Use um MySQL local ou ALLOW_REMOTE_MIGRATIONS=1.`
      )
      return
    }
    const migrationsFolder = path.join(process.cwd(), 'drizzle')
    // AGUARDA a migração antes de o app começar a atender.
    //
    // Antes rodava em background para não atrasar o `app.listen`. O efeito era uma janela de
    // segundos em que o código NOVO consultava colunas que a migração ainda não tinha criado
    // — e nessa janela o catálogo, o checkout e a emissão de certificado respondem erro. Uma
    // migração aditiva leva ~2s, muito abaixo do tempo de partida que o Cloud Run tolera.
    //
    // Continua NÃO-FATAL: se falhar (banco indisponível no boot), loga e sobe assim mesmo,
    // que é o comportamento que já existia. Travar a subida por causa de migração
    // transformaria um problema de schema numa indisponibilidade total.
    try {
      this.logger.log(`Aplicando migrações de ${migrationsFolder}...`)
      await migrate(this.db, { migrationsFolder })
      this.logger.log('Migrações aplicadas com sucesso.')
    } catch (err) {
      this.logger.error('Erro (não-fatal no boot) ao aplicar migrações:', err)
    }
    // Em produção, porém, o código novo não atende sobre o schema antigo: uma migration que falhou no meio deixa o
    // banco sem as tabelas e linhas de que o código depende (sem a matriz, todo endereço responderia 404). Se a última
    // migration do journal não está no banco, a subida falha; a revisão nova não fica pronta e o Cloud Run mantém a
    // anterior com o tráfego.
    if (process.env.NODE_ENV === 'production') await this.exigirUltimaMigration(migrationsFolder)
  }

  private async exigirUltimaMigration(migrationsFolder: string): Promise<void> {
    const journal = JSON.parse(await readFile(path.join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as { entries: Array<{ when: number }> }
    const esperada = ultimaMigrationDoJournal(journal)
    const [linhas] = (await this.db.execute(sql`SELECT MAX(created_at) AS ultima FROM __drizzle_migrations`)) as unknown as [Array<{ ultima: number | string | null }>]
    const noBanco = linhas[0]?.ultima ?? null
    if (migrationsPendentes(esperada, noBanco)) {
      throw new Error(`Migrations pendentes em produção: o banco está em ${noBanco ?? 'nenhuma'} e o código espera ${esperada}. A revisão não sobe para não atender sobre o schema antigo.`)
    }
  }
}
