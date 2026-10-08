import { mysqlTable, varchar, text, timestamp, json, index, boolean } from 'drizzle-orm/mysql-core'

/**
 * Usuário espelhado do Firebase: a identidade GLOBAL da pessoa na rede. `uid` é o UID do Firebase (fonte da identidade).
 * As permissões NÃO moram aqui: os papéis valem por polo e vêm do vínculo (`tenant_members`), e o admin da plataforma é
 * o efetivo (`isEffectivePlatformAdmin`: o sinal abaixo ou o papel admin no vínculo da matriz).
 */
export const users = mysqlTable(
  'users',
  {
    uid: varchar('uid', { length: 128 }).primaryKey(),
    email: varchar('email', { length: 255 }).notNull(),
    displayName: varchar('display_name', { length: 255 }),
    photoUrl: varchar('photo_url', { length: 1024 }),
    /** Linha curta de qualificação do instrutor (ex.: "PhD em CC · 10 anos de mercado"). */
    headline: varchar('headline', { length: 255 }),
    /** Bio/apresentação mais longa do instrutor (exibida na página do curso). */
    bio: text('bio'),
    /** Legado de antes dos polos: não é lido para autorizar nada (os papéis valem por polo, em `tenant_members`). */
    roles: json('roles').$type<string[]>(),
    disabled: boolean('disabled').notNull().default(false),
    /**
     * Sinal da equipe do Studio Pilari. Sozinho não é a regra: o admin da plataforma EFETIVO (aprova cursos, cadastra polos e
     * age como admin em qualquer polo) é este sinal OU o papel admin no vínculo da matriz (`isEffectivePlatformAdmin`).
     */
    isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
    asaasCustomerId: varchar('asaas_customer_id', { length: 64 }),
    cpf: varchar('cpf', { length: 14 }),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).defaultNow(),
  },
  (table) => ({
    emailIdx: index('users_email_idx').on(table.email),
  })
)
