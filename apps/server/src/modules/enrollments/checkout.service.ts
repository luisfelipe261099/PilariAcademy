import { BadRequestException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import type { CheckoutResult, Enrollment, PaymentMode } from '@pilari/types'
import { categories, courses, couponRedemptions, enrollments, orders, users } from '../../db/schema'
import type { Database } from '../../db/types'
import { coverUrl } from '../../common/lib/cover-url'
import { isDuplicateEntry } from '../../common/lib/db-errors'
import { effectivePriceCents, listPriceCents, promoActive } from '../../common/lib/pricing'
import { TenantMembersService } from '../tenancy/tenant-members.service'
import { AsaasService } from './asaas.service'
import { CouponsService } from './coupons.service'
import { InstallmentsService } from './installments.service'

type JoinedRow = {
  course: typeof courses.$inferSelect
  category: typeof categories.$inferSelect | null
  instructorName: string | null
}

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name)

  constructor(
    @Inject('DB_CLIENT') private readonly db: Database,
    private readonly asaas: AsaasService,
    private readonly coupons: CouponsService,
    private readonly installments: InstallmentsService,
    private readonly members: TenantMembersService
  ) {}

  async checkout(
    tenantId: string,
    userUid: string,
    courseIds: string[],
    opts: { couponCode?: string; cpf?: string; paymentMode?: PaymentMode; installmentCount?: number } = {}
  ): Promise<CheckoutResult> {
    const { couponCode, cpf, paymentMode = 'avista', installmentCount } = opts
    if (!courseIds.length) throw new BadRequestException('Carrinho vazio.')

    const rows = (await this.db
      .select({ course: courses, category: categories, instructorName: users.displayName })
      .from(courses)
      .leftJoin(categories, eq(courses.categoryId, categories.id))
      .leftJoin(users, eq(courses.instructorId, users.uid))
      .where(and(eq(courses.tenantId, tenantId), inArray(courses.id, courseIds), eq(courses.status, 'published'), eq(courses.kind, 'online')))) as JoinedRow[]

    if (rows.length !== courseIds.length) throw new BadRequestException('Curso inválido no carrinho.')

    // TODAS as matrículas do aluno nesses cursos — não só as ativas. A unique é
    // (user_id, course_id) e IGNORA o status, então uma linha cancelada continua ocupando
    // o lugar: sem reusá-la, quem cancelou uma compra jamais compraria o curso de novo.
    const existing = await this.db
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.userId, userUid), inArray(enrollments.courseId, courseIds)))
    const byCourse = new Map(existing.map((e) => [e.courseId, e]))
    const owned = new Set(existing.filter((e) => e.status === 'active').map((e) => e.courseId))
    const toBuy = rows.filter((r) => !owned.has(r.course.id))
    if (toBuy.length === 0) throw new ConflictException('Você já possui esses cursos.')
    // RECUSA em vez de descartar em silêncio. O carrinho soma TODOS os itens (o resumo é
    // público e nem sabe quem é o aluno), então descartar aqui cobrava menos do que a tela
    // prometeu: um carrinho de R$ 799,90 com um curso já matriculado virava uma cobrança de
    // R$ 299,90 — em 2x, dois boletos de R$ 149,95 que não fecham com nada que o aluno viu.
    // O que é cobrado tem que ser exatamente o que foi exibido; na dúvida, não cobrar.
    if (toBuy.length !== rows.length) {
      const jaTem = rows.filter((r) => owned.has(r.course.id)).map((r) => r.course.title)
      throw new ConflictException(
        `Remova do carrinho ${jaTem.length === 1 ? 'o curso que você já possui' : 'os cursos que você já possui'}: ${jaTem.join(', ')}.`
      )
    }

    // Compra pendente vira bloqueio EXPLÍCITO, com a mensagem correta, em vez de estourar
    // na unique lá na frente e ser traduzida por um catch que não sabe qual era o status.
    if (toBuy.some((r) => byCourse.get(r.course.id)?.status === 'pending')) {
      throw new ConflictException('Você já tem uma compra pendente para um destes cursos. Conclua ou aguarde o vencimento.')
    }

    const subtotalInCents = toBuy.reduce((sum, r) => sum + effectivePriceCents(r.course), 0)
    const now = new Date()

    let discountInCents = 0
    let appliedCoupon: string | null = null
    if (couponCode) {
      const v = await this.coupons.validateAndCalc(tenantId, couponCode, subtotalInCents, now)
      if (v.couponError) throw new BadRequestException(v.couponError)
      // Teto POR USUÁRIO: um cupom (mesmo 100%-off) só pode ser resgatado uma vez por aluno.
      // Pré-check aqui (mensagem limpa) + unique(code,user) na tabela fecha a race (ver transação).
      if (await this.coupons.alreadyRedeemed(tenantId, couponCode, userUid)) {
        throw new BadRequestException('Você já utilizou este cupom.')
      }
      discountInCents = v.discountInCents
      appliedCoupon = couponCode.toUpperCase()
    }
    const totalInCents = Math.max(0, subtotalInCents - discountInCents)

    // Reserva o cupom de forma ATÔMICA antes de criar qualquer coisa — vale para o ramo
    // pago E para o grátis (total = 0). Isso fecha o "cupom 100% off resgatável infinitas
    // vezes" e a race do maxUses. Se o checkout falhar depois, devolvemos o uso (releaseUse).
    if (appliedCoupon) {
      const reserved = await this.coupons.reserveUse(tenantId, appliedCoupon)
      if (!reserved) throw new BadRequestException('Cupom esgotado.')
    }

    try {
      // Total 0 → matrículas ativas direto, sem Asaas. Tudo numa transação (all-or-nothing).
      if (totalInCents === 0) {
        const built: Enrollment[] = []
        await this.db.transaction(async (tx) => {
          if (appliedCoupon) {
            try {
              await tx.insert(couponRedemptions).values({ id: randomUUID(), tenantId, couponCode: appliedCoupon, userId: userUid, orderId: null, createdAt: now })
            } catch (e) {
              if (isDuplicateEntry(e)) throw new ConflictException('Você já utilizou este cupom.')
              throw e
            }
          }
          for (const r of toBuy) {
            const prev = byCourse.get(r.course.id)
            if (prev) {
              // Reusa a linha cancelada — a unique (user, curso) não deixa inserir outra.
              await tx
                .update(enrollments)
                .set({ status: 'active', source: 'free', orderId: null, activatedAt: now, updatedAt: now })
                .where(eq(enrollments.id, prev.id))
              built.push(this.toEnrollment(prev.id, 'active', 'free', r))
            } else {
              const id = randomUUID()
              await tx.insert(enrollments).values({
                id, userId: userUid, courseId: r.course.id, status: 'active', source: 'free', activatedAt: now, createdAt: now, updatedAt: now,
              })
              built.push(this.toEnrollment(id, 'active', 'free', r))
            }
          }
        })
        await this.garantirVinculo(tenantId, userUid)
        return { paymentUrl: null, enrollments: built }
      }

      // Pago → exige CPF. À vista/cartão criam o LINK de pagamento (o link não aceita
      // `customer`: quem informa o CPF é o próprio aluno, na tela do Asaas). O boleto_parcelado
      // cria um PARCELAMENTO por API, porque aqui QUEM define o número de parcelas somos nós,
      // não o aluno na tela do Asaas. Continuamos guardando o CPF aqui porque é dado da
      // escola, não da cobrança.
      const userRows = await this.db.select().from(users).where(eq(users.uid, userUid)).limit(1)
      const user = userRows[0]
      const useCpf = cpf || user?.cpf
      if (!useCpf) throw new BadRequestException('CPF obrigatório para a compra.')
      if (!user?.cpf) {
        await this.db.update(users).set({ cpf: useCpf, updatedAt: now }).where(eq(users.uid, userUid))
      }

      const orderId = randomUUID()
      const description = `${toBuy.length} curso(s) — Studio Pilari`
      let paymentUrl: string
      let dueDate: string
      let asaasPaymentLinkId: string | null = null
      let asaasInstallmentId: string | null = null
      let asaasCustomerId: string | null = user?.asaasCustomerId ?? null
      let parcelasContratadas: number | null = null

      if (paymentMode === 'boleto_parcelado') {
        const n = installmentCount ?? 0
        if (n < 2 || n > 5) throw new BadRequestException('Escolha de 2 a 5 parcelas.')
        // Piso do Asaas no boleto: R$ 10,00 por parcela. Sem esta guarda o Asaas recusa a
        // criação e o aluno vê um erro genérico depois de preencher tudo.
        if (Math.floor(totalInCents / n) < 1000) {
          throw new BadRequestException('Valor por parcela abaixo do mínimo de R$ 10,00.')
        }
        // Reaproveita o customer já criado para este aluno: reenviar o mesmo CPF ao Asaas a
        // cada compra gera um customer NOVO (a documentação do Asaas avisa disso), o que
        // duplica o cadastro e inutiliza o painel financeiro. Persistimos o id na primeira vez.
        if (!asaasCustomerId) {
          asaasCustomerId = await this.asaas.ensureCustomer({
            name: user?.displayName || user?.email || 'Aluno',
            email: user?.email ?? '',
            cpf: useCpf,
          })
          await this.db.update(users).set({ asaasCustomerId, updatedAt: now }).where(eq(users.uid, userUid))
        }
        // Reconfere matrícula pendente aqui, JÁ NA BEIRA da chamada que cria o parcelamento: não
        // existe endpoint de cancelamento de parcelamento no Asaas, então esta é a última chance
        // de não gerar boletos reais para um pedido que a transação abaixo vai rejeitar. A
        // consulta lá em cima é de bem antes desta linha (passou por validação de cupom e,
        // possivelmente, por uma chamada ao Asaas para criar o customer) — outro checkout pode
        // ter deixado uma matrícula pendente nessa janela. Não fecha a corrida por completo
        // (ainda existe uma janela entre esta checagem e o insert da transação); o controller
        // aceita esse resíduo conscientemente — a alternativa seria não vender por API nenhuma.
        const stillExisting = await this.db
          .select()
          .from(enrollments)
          .where(and(eq(enrollments.userId, userUid), inArray(enrollments.courseId, courseIds)))
        if (toBuy.some((r) => stillExisting.find((e) => e.courseId === r.course.id)?.status === 'pending')) {
          throw new ConflictException('Você já tem uma compra pendente para um destes cursos. Conclua ou aguarde o vencimento.')
        }
        const inst = await this.asaas.createInstallment({
          customerId: asaasCustomerId,
          totalInCents,
          installmentCount: n,
          description,
          externalReference: orderId,
        })
        paymentUrl = inst.paymentUrl
        dueDate = inst.dueDate
        asaasInstallmentId = inst.installmentId
        parcelasContratadas = n
      } else {
        const link = await this.asaas.createPaymentLink({
          name: description,
          amountInCents: totalInCents,
          externalReference: orderId,
          parcelado: paymentMode === 'cartao_parcelado',
        })
        paymentUrl = link.url
        asaasPaymentLinkId = link.linkId
        // Espelha o dueDateLimitDays: 3 enviado ao Asaas — serve só de exibição no admin.
        const due = new Date(now)
        due.setDate(due.getDate() + 3)
        dueDate = due.toISOString().slice(0, 10)
      }

      // Order + matrículas na MESMA transação: se o insert de matrícula falhar (ex.: já existe
      // uma pendente para o curso), o order NÃO fica órfão — evita "aluno paga e não recebe".
      await this.db.transaction(async (tx) => {
        if (appliedCoupon) {
          try {
            await tx.insert(couponRedemptions).values({ id: randomUUID(), tenantId, couponCode: appliedCoupon, userId: userUid, orderId, createdAt: now })
          } catch (e) {
            if (isDuplicateEntry(e)) throw new ConflictException('Você já utilizou este cupom.')
            throw e
          }
        }
        await tx.insert(orders).values({
          id: orderId, tenantId, userId: userUid, status: 'pending',
          subtotalInCents, discountInCents, totalInCents, couponCode: appliedCoupon,
          // O pagamento nasce só quando o aluno paga — quem ancora o pedido é o
          // link (à vista/cartão) ou o parcelamento (carnê).
          asaasChargeId: null, asaasPaymentLinkId, asaasCustomerId,
          billingType: null, paymentMode, asaasInstallmentId, installmentCount: parcelasContratadas,
          paymentUrl, dueDate, createdAt: now, updatedAt: now,
        })
        // Cursos com matrícula cancelada reusam a linha (a unique impede uma segunda);
        // os demais entram como linha nova, num insert só.
        const novos = toBuy.filter((r) => !byCourse.has(r.course.id))
        for (const r of toBuy) {
          const prev = byCourse.get(r.course.id)
          if (!prev) continue
          await tx
            .update(enrollments)
            .set({ status: 'pending', source: 'purchase', orderId, activatedAt: null, updatedAt: now })
            .where(eq(enrollments.id, prev.id))
        }
        if (novos.length) {
          await tx.insert(enrollments).values(
            novos.map((r) => ({
              id: randomUUID(), userId: userUid, courseId: r.course.id, status: 'pending' as const, source: 'purchase' as const, orderId, createdAt: now, updatedAt: now,
            }))
          )
        }
      })
      await this.garantirVinculo(tenantId, userUid)

      // Depois da transação de propósito: se a listagem no Asaas falhar, o pedido e as
      // matrículas já estão salvos e a reconciliação recupera as parcelas depois. O
      // inverso — perder o pedido por causa de uma listagem — seria pior. Por isso este bloco
      // tem o PRÓPRIO try/catch: um erro aqui NUNCA pode cair no catch externo do método, que
      // devolveria o uso do cupom (já commitado) e responderia ao aluno com um erro genérico
      // para um pedido cujos boletos já existem de verdade no Asaas.
      if (asaasInstallmentId) {
        try {
          const parcelas = await this.asaas.listInstallmentPayments(asaasInstallmentId)
          await this.installments.recordFromPayments(orderId, parcelas)
        } catch (e) {
          this.logger.error(
            `Falha ao listar/gravar as parcelas do pedido ${orderId} (installment ${asaasInstallmentId}): ${e instanceof Error ? e.message : String(e)}`
          )
        }
      }

      return { paymentUrl, enrollments: [] }
    } catch (err) {
      // Compensa o uso do cupom reservado — o checkout não se concretizou.
      if (appliedCoupon) await this.coupons.releaseUse(tenantId, appliedCoupon)
      if (isDuplicateEntry(err)) {
        throw new ConflictException('Você já tem uma compra pendente para um destes cursos. Conclua ou aguarde o vencimento.')
      }
      throw err
    }
  }

  /**
   * Comprar garante o vínculo de aluno no polo da compra (B3), como a cortesia; a plataforma nunca vira aluna de polo. Roda
   * depois de a compra estar gravada e nunca a desfaz: uma falha aqui só vai para o log (o próximo login cria o vínculo),
   * e não pode cair no catch do checkout, que devolveria o uso de um cupom já resgatado.
   */
  private async garantirVinculo(tenantId: string, userUid: string): Promise<void> {
    try {
      await this.members.ensureStudentUnlessPlatform(tenantId, userUid)
    } catch (e) {
      this.logger.error(`Vínculo de aluno do comprador ${userUid} no polo ${tenantId} não foi criado: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  private toEnrollment(id: string, status: Enrollment['status'], source: Enrollment['source'], row: JoinedRow): Enrollment {
    const c = row.course
    return {
      id,
      courseId: c.id,
      status,
      source,
      paymentStatus: null,
      progressPercent: 0,
      course: {
        id: c.id, slug: c.slug, title: c.title, subtitle: c.subtitle, kind: c.kind,
        priceInCents: effectivePriceCents(c), listPriceInCents: listPriceCents(c), promoEndsAt: c.promoEndsAt && promoActive(c) ? c.promoEndsAt.toISOString() : null,
        coverImageUrl: coverUrl(c.id, c.coverImageUrl), coverFocus: c.coverFocus ?? null,
        category: row.category ? { id: row.category.id, name: row.category.name, slug: row.category.slug } : null,
        instructorName: row.instructorName,
        availableAt: c.availableAt ? c.availableAt.toISOString() : null,
      },
    }
  }
}
