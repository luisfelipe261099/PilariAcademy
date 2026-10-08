import { mysqlTable, varchar, timestamp, index } from 'drizzle-orm/mysql-core'

/** Trilha de auditoria — quem fez o quê e quando. */
export const auditLogs = mysqlTable(
  'audit_logs',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 36 }),
    actorUid: varchar('actor_uid', { length: 128 }),
    actorEmail: varchar('actor_email', { length: 255 }),
    action: varchar('action', { length: 64 }).notNull(),
    summary: varchar('summary', { length: 500 }).notNull(),
    targetType: varchar('target_type', { length: 40 }),
    targetId: varchar('target_id', { length: 64 }),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).defaultNow(),
  },
  (t) => ({
    createdIdx: index('audit_logs_created_idx').on(t.createdAt),
    tenantIdx: index('audit_logs_tenant_idx').on(t.tenantId),
  })
)
