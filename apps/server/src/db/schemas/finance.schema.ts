import { mysqlTable, varchar, int, timestamp, index, unique } from 'drizzle-orm/mysql-core'

/** Ganho "fotografado" por curso no momento do pagamento do pedido. */
export const earnings = mysqlTable(
  'earnings',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 36 }).notNull(),
    orderId: varchar('order_id', { length: 36 }).notNull(),
    courseId: varchar('course_id', { length: 36 }).notNull(),
    instructorId: varchar('instructor_id', { length: 128 }).notNull(),
    grossInCents: int('gross_in_cents').notNull(),
    /** Taxa do Asaas atribuída a este curso (fatia proporcional da taxa do pedido). */
    asaasFeeInCents: int('asaas_fee_in_cents').notNull().default(0),
    commissionPercent: int('commission_percent').notNull(),
    netInCents: int('net_in_cents').notNull(),
    /**
     * Cobrança que originou este ganho. String vazia = ganho do pedido inteiro
     * (à vista/cartão). NOT NULL de propósito: índice UNIQUE do MySQL admite múltiplos
     * NULL, e com a coluna nullable as linhas à vista deixariam de ser protegidas.
     */
    asaasChargeId: varchar('asaas_charge_id', { length: 64 }).notNull().default(''),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).defaultNow(),
  },
  (t) => ({
    orderCourseChargeUnq: unique('earnings_order_course_charge_unq').on(t.orderId, t.courseId, t.asaasChargeId),
    instructorIdx: index('earnings_instructor_idx').on(t.instructorId),
    tenantIdx: index('earnings_tenant_idx').on(t.tenantId),
  })
)

/** Repasse registrado (admin marcou como pago). */
export const payouts = mysqlTable(
  'payouts',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 36 }).notNull(),
    instructorId: varchar('instructor_id', { length: 128 }).notNull(),
    amountInCents: int('amount_in_cents').notNull(),
    note: varchar('note', { length: 255 }),
    paidAt: timestamp('paid_at', { mode: 'date', fsp: 3 }).defaultNow(),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).defaultNow(),
  },
  (t) => ({
    instructorIdx: index('payouts_instructor_idx').on(t.instructorId),
    tenantIdx: index('payouts_tenant_idx').on(t.tenantId),
  })
)
