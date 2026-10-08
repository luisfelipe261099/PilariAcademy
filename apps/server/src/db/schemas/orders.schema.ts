import { mysqlTable, varchar, int, boolean, timestamp, index, unique } from 'drizzle-orm/mysql-core'
import type { OrderStatus, CouponType, PaymentMode, InstallmentStatus } from '@pilari/types'

/** Pedido = 1 cobrança Asaas cobrindo N cursos (gera N matrículas). */
export const orders = mysqlTable(
  'orders',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 36 }).notNull(),
    userId: varchar('user_id', { length: 128 }).notNull(),
    status: varchar('status', { length: 16 }).$type<OrderStatus>().notNull().default('pending'),
    subtotalInCents: int('subtotal_in_cents').notNull(),
    discountInCents: int('discount_in_cents').notNull().default(0),
    totalInCents: int('total_in_cents').notNull(),
    couponCode: varchar('coupon_code', { length: 40 }),
    asaasChargeId: varchar('asaas_charge_id', { length: 64 }).unique(),
    asaasCustomerId: varchar('asaas_customer_id', { length: 64 }),
    /**
     * Id do link de pagamento no Asaas. É a âncora do pedido: o `asaasChargeId` só passa
     * a existir depois que o aluno paga, porque o link cria a cobrança no ato do pagamento.
     */
    asaasPaymentLinkId: varchar('asaas_payment_link_id', { length: 64 }),
    /** Taxa que o Asaas cobrou nesta cobrança (value − netValue), em centavos. */
    asaasFeeInCents: int('asaas_fee_in_cents'),
    billingType: varchar('billing_type', { length: 16 }),
    /** Parcelas escolhidas pelo aluno na tela do Asaas. null = à vista ou ainda não pago. */
    installmentCount: int('installment_count'),
    /** O que o aluno escolheu no carrinho. Registra a INTENÇÃO. */
    paymentMode: varchar('payment_mode', { length: 24 }).$type<PaymentMode>(),
    /**
     * Id do plano de parcelamento no Asaas. Este é o DISCRIMINADOR de carnê — não use
     * `paymentMode`, que registra a intenção e pode divergir do que o Asaas de fato criou.
     */
    asaasInstallmentId: varchar('asaas_installment_id', { length: 64 }),
    /** Pedido quitado. À vista/cartão: junto com paidAt. Carnê: na última parcela paga. */
    settledAt: timestamp('settled_at', { mode: 'date', fsp: 3 }),
    paymentUrl: varchar('payment_url', { length: 1024 }),
    dueDate: varchar('due_date', { length: 10 }),
    /**
     * Do que se trata a cobrança, quando ela NÃO vem de curso. O vínculo pedido→curso é
     * pela `enrollments.orderId`, então uma cobrança avulsa (taxa, segunda via,
     * renegociação) é um pedido sem matrícula nenhuma — e sem isto a tela não teria o que
     * mostrar na linha. null = pedido de curso, o nome sai das matrículas.
     */
    description: varchar('description', { length: 200 }),
    /** uid do admin que criou a cobrança pela tela. null = checkout feito pelo aluno. */
    createdByAdmin: varchar('created_by_admin', { length: 128 }),
    paidAt: timestamp('paid_at', { mode: 'date', fsp: 3 }),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).defaultNow(),
  },
  (t) => ({ userIdx: index('orders_user_idx').on(t.userId), tenantIdx: index('orders_tenant_idx').on(t.tenantId) })
)

/**
 * Uma parcela do carnê. Gravadas TODAS no checkout, não conforme os webhooks chegam —
 * é isso que permite localizar o pedido a partir de qualquer parcela sem depender de
 * herança de campo do Asaas.
 *
 * O UNIQUE em `asaasChargeId` é a chave de idempotência do sistema inteiro: webhook
 * reenviado, reconciliação e baixa manual convergem para a mesma linha.
 */
export const orderInstallments = mysqlTable(
  'order_installments',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    orderId: varchar('order_id', { length: 36 }).notNull(),
    asaasChargeId: varchar('asaas_charge_id', { length: 64 }).notNull().unique(),
    installmentNumber: int('installment_number'),
    valueInCents: int('value_in_cents').notNull(),
    /** Taxa REAL daquela parcela (value − netValue). O Asaas cobra por boleto pago. */
    asaasFeeInCents: int('asaas_fee_in_cents'),
    status: varchar('status', { length: 16 }).$type<InstallmentStatus>().notNull().default('pending'),
    dueDate: varchar('due_date', { length: 10 }),
    paidAt: timestamp('paid_at', { mode: 'date', fsp: 3 }),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).defaultNow(),
  },
  (t) => ({ orderIdx: index('order_installments_order_idx').on(t.orderId) })
)

/** Cupom de desconto gerenciado pelo admin. */
export const coupons = mysqlTable(
  'coupons',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 36 }).notNull(),
    code: varchar('code', { length: 40 }).notNull(),
    type: varchar('type', { length: 16 }).$type<CouponType>().notNull(),
    value: int('value').notNull(),
    validUntil: timestamp('valid_until', { mode: 'date', fsp: 3 }),
    maxUses: int('max_uses'),
    usedCount: int('used_count').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', fsp: 3 }).defaultNow(),
  },
  (t) => ({ tenantCodeUnq: unique('coupons_tenant_code_unq').on(t.tenantId, t.code) })
)

/**
 * Resgate de cupom por usuário. `coupons.usedCount`/`maxUses` é o teto GLOBAL; esta tabela é o
 * teto POR USUÁRIO — a unique (code, user) impede o mesmo aluno de resgatar o cupom mais de uma
 * vez (fecha o "100%-off ilimitado por um único aluno"). `orderId` é nulo no checkout grátis.
 */
export const couponRedemptions = mysqlTable(
  'coupon_redemptions',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 36 }).notNull(),
    couponCode: varchar('coupon_code', { length: 40 }).notNull(),
    userId: varchar('user_id', { length: 128 }).notNull(),
    orderId: varchar('order_id', { length: 36 }),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).defaultNow(),
  },
  (t) => ({
    couponUserUnq: unique('coupon_redemptions_tenant_coupon_user_unq').on(t.tenantId, t.couponCode, t.userId),
    userIdx: index('coupon_redemptions_user_idx').on(t.userId),
  })
)
