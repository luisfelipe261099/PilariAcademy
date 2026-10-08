import { mysqlTable, varchar, boolean, json, timestamp, index, primaryKey } from 'drizzle-orm/mysql-core'
import type { TenantBranding, TenantStatus } from '@pilari/types'

/** Polo parceiro. O Studio Pilari é o polo `pilari` com is_matriz = true. */
export const tenants = mysqlTable('tenants', {
  id: varchar('id', { length: 36 }).primaryKey(),
  /** Subdomínio do polo: <slug>.cursos.studiopilari.com.br. */
  slug: varchar('slug', { length: 40 }).notNull().unique(),
  name: varchar('name', { length: 160 }).notNull(),
  status: varchar('status', { length: 16 }).$type<TenantStatus>().notNull().default('active'),
  isMatriz: boolean('is_matriz').notNull().default(false),
  branding: json('branding').$type<TenantBranding>().notNull(),
  createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).defaultNow(),
})

/** Endereços que resolvem um polo: subdomínio primário e domínios próprios. */
export const tenantDomains = mysqlTable(
  'tenant_domains',
  {
    /** Minúsculo, sem porta, sem ponto final. */
    host: varchar('host', { length: 253 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 36 }).notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).defaultNow(),
  },
  (t) => ({ tenantIdx: index('tenant_domains_tenant_idx').on(t.tenantId) })
)

/** Vínculo de um usuário (global) com um polo, com os papéis dentro do polo. */
export const tenantMembers = mysqlTable(
  'tenant_members',
  {
    tenantId: varchar('tenant_id', { length: 36 }).notNull(),
    userUid: varchar('user_uid', { length: 128 }).notNull(),
    /** Role[] dentro do polo: 'admin' | 'teacher' | 'student'. */
    roles: json('roles').$type<string[]>().notNull(),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ name: 'tenant_members_pk', columns: [t.tenantId, t.userUid] }),
    userIdx: index('tenant_members_user_idx').on(t.userUid),
  })
)
