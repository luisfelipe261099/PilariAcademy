import { mysqlTable, varchar, int, timestamp, index, unique } from 'drizzle-orm/mysql-core'
import type { EnrollmentSource, EnrollmentStatus, AsaasPaymentStatus } from '@pilari/types'

/** Matrícula = direito de acesso aluno↔curso. `orderId` agrupa as matrículas de um pedido. */
export const enrollments = mysqlTable(
  'enrollments',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 128 }).notNull(),
    courseId: varchar('course_id', { length: 36 }).notNull(),
    status: varchar('status', { length: 16 }).$type<EnrollmentStatus>().notNull().default('pending'),
    source: varchar('source', { length: 16 }).$type<EnrollmentSource>().notNull(),
    orderId: varchar('order_id', { length: 36 }),
    /** Rodadas de tentativa de prova. Cada rodada = +5 tentativas por módulo. Liberação de repetente incrementa. */
    quizAttemptRounds: int('quiz_attempt_rounds').notNull().default(1),
    activatedAt: timestamp('activated_at', { mode: 'date', fsp: 3 }),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).defaultNow(),
  },
  (t) => ({
    userCourseUnq: unique('enrollments_user_course_unq').on(t.userId, t.courseId),
    userIdx: index('enrollments_user_idx').on(t.userId),
    courseIdx: index('enrollments_course_idx').on(t.courseId),
  })
)

/**
 * @deprecated Substituída por `orders` no redesenho do carrinho. Mantida (vazia) só
 * para evitar prompt interativo de rename no drizzle-kit; remover num passo dedicado.
 */
export const payments = mysqlTable(
  'payments',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    enrollmentId: varchar('enrollment_id', { length: 36 }).notNull(),
    asaasChargeId: varchar('asaas_charge_id', { length: 64 }).notNull().unique(),
    asaasCustomerId: varchar('asaas_customer_id', { length: 64 }).notNull(),
    amountInCents: int('amount_in_cents').notNull(),
    billingType: varchar('billing_type', { length: 16 }).notNull(),
    status: varchar('status', { length: 16 }).$type<AsaasPaymentStatus>().notNull(),
    paymentUrl: varchar('payment_url', { length: 1024 }),
    dueDate: varchar('due_date', { length: 10 }),
    paidAt: timestamp('paid_at', { mode: 'date', fsp: 3 }),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).defaultNow(),
  },
  (t) => ({ enrollmentIdx: index('payments_enrollment_idx').on(t.enrollmentId) })
)
