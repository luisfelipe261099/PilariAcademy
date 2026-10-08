import { mysqlTable, varchar, int, mediumtext, timestamp, primaryKey } from 'drizzle-orm/mysql-core'

/**
 * Texto extraído de um PDF anexado às aulas, usado como material do tutor de voz. A chave é o hash do caminho do
 * objeto no GCS: cada upload ganha um caminho novo, então trocar o PDF gera outra linha e a antiga só fica sem uso.
 * O mesmo PDF anexado em várias aulas é extraído uma vez só.
 */
export const tutorMaterialCache = mysqlTable('tutor_material_cache', {
  sourceHash: varchar('source_hash', { length: 64 }).primaryKey(),
  fileUrl: varchar('file_url', { length: 1024 }).notNull(),
  text: mediumtext('text').notNull(),
  chars: int('chars').notNull(),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).defaultNow(),
})

/** Uso do tutor por aluno e dia (America/Sao_Paulo), para o limite diário. Não guarda áudio nem transcrição. */
export const tutorUsage = mysqlTable(
  'tutor_usage',
  {
    userUid: varchar('user_uid', { length: 128 }).notNull(),
    /** YYYY-MM-DD no fuso de Brasília. */
    day: varchar('day', { length: 10 }).notNull(),
    seconds: int('seconds').notNull().default(0),
    requests: int('requests').notNull().default(0),
    updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).defaultNow(),
  },
  (t) => ({ pk: primaryKey({ name: 'tutor_usage_pk', columns: [t.userUid, t.day] }) })
)
