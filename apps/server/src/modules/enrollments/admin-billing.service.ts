import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { and, desc, eq, inArray, like, or, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { AdminOrderRow, EnrollmentSource, EnrollmentStatus, StudentFinance, StudentHit } from '@pilari/types'
import { orders, orderInstallments } from '../../db/schemas/orders.schema'
import { enrollments } from '../../db/schemas/enrollments.schema'
import { courses } from '../../db/schemas/courses.schema'
import { tenantMembers } from '../../db/schemas/tenants.schema'
import { users } from '../../db/schemas/users.schema'
import type { Database } from '../../db/types'
import { AsaasService, resolveDueDate } from './asaas.service'
import { TenantMembersService } from '../tenancy/tenant-members.service'

/** Teto do carnê, igual ao do checkout do aluno: o Asaas cobra taxa por boleto emitido. */
const MAX_PARCELAS = 5
/** Piso por parcela (R$ 5,00): abaixo disso a taxa do boleto come a parcela inteira. */
const MIN_PARCELA_CENTS = 500

/** Matrícula já existente para o par aluno+curso, como estava ANTES da cobrança. */
interface MatriculaExistente {
  id: string
  courseId: string
  status: EnrollmentStatus
  source: EnrollmentSource
  orderId: string | null
}

function onlyDigits(v: string | null | undefined): string {
  return (v ?? '').replace(/\D+/g, '')
}

/**
 * Financeiro do aluno pela visão do admin: consultar, criar cobrança e baixar o boleto.
 *
 * TUDO aqui fala com o Asaas de PRODUÇÃO. Criar uma cobrança emite um boleto de verdade,
 * que chega ao aluno por e-mail. Por isso cada método que escreve valida antes e registra
 * quem fez — não existe "criar para testar".
 *
 * Tudo aqui é do POLO: só se cobra e se consulta aluno que é membro do polo, e só se cancela ou se baixa
 * o boleto de pedido do polo. O que é de outro polo responde 404, antes de qualquer chamada ao Asaas.
 */
@Injectable()
export class AdminBillingService {
  private readonly logger = new Logger(AdminBillingService.name)

  constructor(
    @Inject('DB_CLIENT') private readonly db: Database,
    private readonly asaas: AsaasService,
    private readonly members: TenantMembersService
  ) {}

  /** Busca aluno do polo por nome, e-mail ou CPF. O CPF casa com ou sem pontuação. */
  async searchStudents(tenantId: string, q: string): Promise<StudentHit[]> {
    const termo = q.trim()
    if (termo.length < 3) return []
    const digitos = onlyDigits(termo)
    const alvo = `%${termo.toLowerCase()}%`
    const rows = await this.db
      .select({ uid: users.uid, name: users.displayName, email: users.email, cpf: users.cpf })
      .from(users)
      .innerJoin(tenantMembers, and(eq(tenantMembers.userUid, users.uid), eq(tenantMembers.tenantId, tenantId)))
      .where(
        or(
          like(sql`lower(${users.displayName})`, alvo),
          like(sql`lower(${users.email})`, alvo),
          // Só tenta CPF quando o termo tem dígitos, senão `%%` casaria com todo mundo.
          digitos.length >= 3 ? like(users.cpf, `%${digitos}%`) : undefined
        )
      )
      .limit(20)
    return rows.map((r) => ({ uid: r.uid, name: r.name, email: r.email, cpf: r.cpf }))
  }

  /** Ficha financeira: os pedidos do aluno NO POLO, com parcelas e cursos. Quem não é do polo responde 404. */
  async financeOf(tenantId: string, uid: string): Promise<StudentFinance> {
    if (!(await this.members.isMember(tenantId, uid))) throw new NotFoundException('Aluno não encontrado neste polo.')
    const userRows = await this.db
      .select({ uid: users.uid, name: users.displayName, email: users.email, cpf: users.cpf })
      .from(users)
      .where(eq(users.uid, uid))
      .limit(1)
    const u = userRows[0]
    if (!u) throw new NotFoundException('Aluno não encontrado.')

    const rows = await this.db.select().from(orders).where(and(eq(orders.userId, uid), eq(orders.tenantId, tenantId))).orderBy(desc(orders.createdAt))
    const ids = rows.map((r) => r.id)

    // Uma consulta para TODOS os pedidos, nunca uma por pedido — mesmo padrão da lista geral.
    const titleRows = ids.length
      ? await this.db
          .select({ orderId: enrollments.orderId, title: courses.title })
          .from(enrollments)
          .innerJoin(courses, eq(courses.id, enrollments.courseId))
          .where(inArray(enrollments.orderId, ids))
      : []
    const titulos = new Map<string, string[]>()
    for (const t of titleRows) {
      if (!t.orderId) continue
      titulos.set(t.orderId, [...(titulos.get(t.orderId) ?? []), t.title])
    }

    const parcRows = ids.length
      ? await this.db.select().from(orderInstallments).where(inArray(orderInstallments.orderId, ids))
      : []
    const parcelas = new Map<string, typeof parcRows>()
    for (const p of parcRows) parcelas.set(p.orderId, [...(parcelas.get(p.orderId) ?? []), p])

    const pedidos: AdminOrderRow[] = rows.map((r) => ({
      id: r.id,
      userEmail: u.email,
      userName: u.name,
      status: r.status,
      totalInCents: r.totalInCents,
      billingType: r.billingType ?? null,
      installmentCount: r.installmentCount ?? null,
      asaasChargeId: r.asaasChargeId ?? null,
      paymentUrl: r.paymentUrl ?? null,
      dueDate: r.dueDate ?? null,
      paidAt: r.paidAt ? r.paidAt.toISOString() : null,
      createdAt: r.createdAt ? r.createdAt.toISOString() : null,
      courseTitles: titulos.get(r.id) ?? [],
      paymentMode: r.paymentMode ?? null,
      installments: (parcelas.get(r.id) ?? [])
        .sort((a, b) => (a.installmentNumber ?? 0) - (b.installmentNumber ?? 0))
        .map((p) => ({
          installmentNumber: p.installmentNumber,
          status: p.status,
          valueInCents: p.valueInCents,
          dueDate: p.dueDate ?? null,
          paidAt: p.paidAt ? p.paidAt.toISOString() : null,
        })),
      settledAt: r.settledAt ? r.settledAt.toISOString() : null,
      description: r.description ?? null,
      createdByAdmin: r.createdByAdmin ?? null,
    }))

    const emAberto = pedidos
      .filter((p) => p.status === 'pending')
      .reduce((soma, p) => soma + p.totalInCents, 0)
    const pago = pedidos.filter((p) => p.status === 'paid').reduce((soma, p) => soma + p.totalInCents, 0)

    return {
      student: { uid: u.uid, name: u.name, email: u.email, cpf: u.cpf },
      orders: pedidos,
      totalPendingInCents: emAberto,
      totalPaidInCents: pago,
    }
  }

  /**
   * Cria uma cobrança para o aluno. Emite boleto REAL no Asaas.
   *
   * `courseIds` vazio = cobrança avulsa (a `description` é obrigatória e nada é liberado no
   * pagamento). Com cursos, cria as matrículas `pending` e o webhook as ativa quando o
   * dinheiro entra — é o mesmo caminho do checkout do aluno, não um paralelo.
   */
  async createCharge(
    tenantId: string,
    adminUid: string,
    input: {
      userId: string
      courseIds: string[]
      description?: string
      amountInCents?: number
      installmentCount: number
      /** Informado pelo admin quando o aluno ainda não tem CPF no cadastro. */
      cpf?: string
      /** Libera o acesso JÁ, sem esperar o pagamento (aluno começa a estudar cobrado). */
      enrollNow?: boolean
      /** Vencimento AAAA-MM-DD. No carnê, é o da PRIMEIRA parcela. Ausente = 3 dias. */
      dueDate?: string
    }
  ): Promise<{ orderId: string; paymentUrl: string }> {
    // Quem não é do polo não existe para ele: nem consulta o cadastro, nem fala com o Asaas.
    if (!(await this.members.isMember(tenantId, input.userId))) throw new NotFoundException('Aluno não encontrado neste polo.')
    const userRows = await this.db
      .select({ uid: users.uid, name: users.displayName, email: users.email, cpf: users.cpf })
      .from(users)
      .where(eq(users.uid, input.userId))
      .limit(1)
    const aluno = userRows[0]
    if (!aluno) throw new NotFoundException('Aluno não encontrado.')

    // O Asaas exige CPF no cliente. Aluno que nunca comprou normalmente não tem CPF no
    // cadastro — e recusar aí travava justamente o caso de uso desta tela: cobrar alguém
    // que ainda não é aluno de nada. O admin informa na hora, e o CPF é SALVO no cadastro,
    // senão ele teria que digitar de novo na próxima cobrança.
    const cpf = onlyDigits(aluno.cpf) || onlyDigits(input.cpf)
    if (cpf.length !== 11) {
      throw new BadRequestException('Informe o CPF do aluno (11 dígitos) para emitir a cobrança.')
    }
    if (!onlyDigits(aluno.cpf)) {
      await this.db.update(users).set({ cpf, updatedAt: new Date() }).where(eq(users.uid, aluno.uid))
    }
    if (!aluno.email) throw new BadRequestException('O aluno precisa ter e-mail cadastrado.')

    const parcelas = input.installmentCount
    if (!Number.isInteger(parcelas) || parcelas < 1 || parcelas > MAX_PARCELAS) {
      throw new BadRequestException(`Parcelas devem ser de 1 a ${MAX_PARCELAS}.`)
    }

    // Valida o vencimento AQUI, junto das outras recusas, e não lá na chamada ao Asaas: como
    // aquela acontece depois do insert do pedido, uma data inválida criava o pedido, falhava
    // e cancelava — trabalho e ruído na ficha por algo que dá para recusar de cara.
    resolveDueDate(input.dueDate)

    const { total, descricao, cursos, reaproveitar } = await this.resolveCobranca(tenantId, input)

    if (parcelas > 1 && Math.floor(total / parcelas) < MIN_PARCELA_CENTS) {
      throw new BadRequestException(
        `Parcela ficaria abaixo de R$ ${(MIN_PARCELA_CENTS / 100).toFixed(2)} — reduza o número de parcelas.`
      )
    }

    const orderId = randomUUID()
    const customerId = await this.asaas.ensureCustomer({ name: aluno.name ?? aluno.email, email: aluno.email, cpf })

    // A linha do pedido nasce ANTES da chamada ao Asaas: se a criação lá falhar, sobra um
    // pedido `pending` sem âncora (visível e cancelável) em vez de um boleto órfão que
    // ninguém no sistema conhece — o inverso é o que dói.
    const now = new Date()
    await this.db.insert(orders).values({
      id: orderId,
      tenantId,
      userId: aluno.uid,
      status: 'pending',
      subtotalInCents: total,
      discountInCents: 0,
      totalInCents: total,
      asaasCustomerId: customerId,
      paymentMode: parcelas > 1 ? 'boleto_parcelado' : 'avista',
      description: cursos.length > 0 ? null : descricao,
      createdByAdmin: adminUid,
      createdAt: now,
      updatedAt: now,
    })

    // Matrículas pendentes: o webhook de pagamento ativa por `orderId`. Sem elas, pagar não
    // libera nada — que é exatamente o comportamento da cobrança avulsa.
    if (cursos.length > 0) {
      // `enrollNow` libera o acesso ANTES do pagamento — para quando a instituição decide
      // deixar o aluno começar enquanto paga. O webhook ativa por orderId de qualquer jeito,
      // e ativar o que já está ativo é inofensivo.
      const status = input.enrollNow ? ('active' as const) : ('pending' as const)
      // Matrícula que já existe vira "de compra" ligada a este pedido: o certificado passa a
      // esperar a quitação e o repasse do instrutor enxerga o curso. Cortesia ATIVA continua
      // ativa — o acesso que a instituição já deu não é retirado por passar a ser cobrado;
      // cancelada segue `enrollNow` como uma matrícula nova.
      for (const e of reaproveitar) {
        const ativa = e.status === 'active' || !!input.enrollNow
        await this.db
          .update(enrollments)
          .set({
            orderId,
            source: 'purchase' as const,
            status: ativa ? ('active' as const) : ('pending' as const),
            ...(e.status === 'active' ? {} : { activatedAt: ativa ? now : null }),
            updatedAt: now,
          })
          .where(eq(enrollments.id, e.id))
      }
      const novas = cursos.filter((c) => !reaproveitar.some((e) => e.courseId === c.id))
      if (novas.length > 0) {
        await this.db.insert(enrollments).values(
          novas.map((c) => ({
            id: randomUUID(),
            userId: aluno.uid,
            courseId: c.id,
            orderId,
            status,
            source: 'purchase' as const,
            activatedAt: input.enrollNow ? now : null,
            createdAt: now,
            updatedAt: now,
          }))
        )
      }
    }

    try {
      if (parcelas > 1) {
        const r = await this.asaas.createInstallment({
          customerId,
          totalInCents: total,
          installmentCount: parcelas,
          description: descricao,
          externalReference: orderId,
          dueDate: input.dueDate,
        })
        await this.db
          .update(orders)
          .set({
            asaasInstallmentId: r.installmentId,
            asaasChargeId: r.chargeId,
            paymentUrl: r.paymentUrl,
            dueDate: r.dueDate,
            billingType: 'BOLETO',
            installmentCount: parcelas,
            updatedAt: new Date(),
          })
          .where(eq(orders.id, orderId))
        await this.gravarParcelas(orderId, r.installmentId)
        return { orderId, paymentUrl: r.paymentUrl }
      }

      const r = await this.asaas.createCharge({
        customerId,
        amountInCents: total,
        description: descricao,
        externalReference: orderId,
        dueDate: input.dueDate,
      })
      await this.db
        .update(orders)
        .set({
          asaasChargeId: r.chargeId,
          paymentUrl: r.paymentUrl,
          dueDate: r.dueDate,
          billingType: r.billingType,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, orderId))
      return { orderId, paymentUrl: r.paymentUrl }
    } catch (err) {
      // Cancela o rascunho: um pedido `pending` sem cobrança no Asaas nunca vai ser pago e
      // só polui a ficha do aluno e a fila de reconciliação.
      await this.db
        .update(orders)
        .set({ status: 'canceled', updatedAt: new Date() })
        .where(eq(orders.id, orderId))
      // Reaproveitadas voltam ao que eram (a cortesia não some por uma falha do Asaas);
      // só depois as rascunhadas neste pedido são canceladas — a ordem importa, porque a
      // restauração desfaz o vínculo com o orderId que o cancelamento usa.
      for (const e of reaproveitar) {
        await this.db
          .update(enrollments)
          .set({ status: e.status, source: e.source, orderId: e.orderId, updatedAt: new Date() })
          .where(eq(enrollments.id, e.id))
      }
      await this.db
        .update(enrollments)
        .set({ status: 'canceled', updatedAt: new Date() })
        .where(eq(enrollments.orderId, orderId))
      this.logger.error(`Falha ao criar cobrança no Asaas (pedido ${orderId} cancelado):`, err)
      throw new BadRequestException(`Não foi possível criar a cobrança: ${(err as Error).message}`)
    }
  }

  /** Valida a entrada e devolve valor, descrição e cursos. Só cursos do polo: o de outro polo não é encontrado. */
  private async resolveCobranca(tenantId: string, input: {
    userId: string
    courseIds: string[]
    description?: string
    amountInCents?: number
  }): Promise<{
    total: number
    descricao: string
    cursos: { id: string; title: string }[]
    /** Matrículas já existentes (cortesia ativa ou cancelada) que a criação reaproveita. */
    reaproveitar: MatriculaExistente[]
  }> {
    if (input.courseIds.length === 0) {
      const descricao = (input.description ?? '').trim()
      if (!descricao) throw new BadRequestException('Descreva do que se trata a cobrança.')
      const total = input.amountInCents ?? 0
      if (!Number.isInteger(total) || total <= 0) throw new BadRequestException('Informe um valor maior que zero.')
      return { total, descricao, cursos: [], reaproveitar: [] }
    }

    const cursos = await this.db
      .select({ id: courses.id, title: courses.title, price: courses.priceInCents, promo: courses.promoPriceInCents })
      .from(courses)
      .where(and(eq(courses.tenantId, tenantId), inArray(courses.id, input.courseIds)))
    if (cursos.length !== input.courseIds.length) throw new BadRequestException('Curso não encontrado.')

    // A matrícula é ÚNICA por aluno+curso, então o que já existe decide: barra ou reaproveita.
    const existentes: MatriculaExistente[] = await this.db
      .select({
        id: enrollments.id,
        courseId: enrollments.courseId,
        status: enrollments.status,
        source: enrollments.source,
        orderId: enrollments.orderId,
      })
      .from(enrollments)
      .where(and(eq(enrollments.userId, input.userId), inArray(enrollments.courseId, input.courseIds)))
    const nomesDe = (lista: { courseId: string }[]) =>
      cursos.filter((c) => lista.some((e) => e.courseId === c.id)).map((c) => c.title).join(', ')

    // Já comprou: cobrar de novo por algo já pago é o erro mais caro que esta tela pode cometer.
    const compradas = existentes.filter((e) => e.status === 'active' && e.source === 'purchase')
    if (compradas.length > 0) {
      throw new BadRequestException(`O aluno já está matriculado por compra em: ${nomesDe(compradas)}.`)
    }
    // Pedido em aberto pelo mesmo curso: outro boleto seria cobrança dobrada pelo mesmo acesso
    // (e a linha única não comportaria as duas). Cancelar o pedido anterior libera.
    const emAberto = existentes.filter((e) => e.status === 'pending')
    if (emAberto.length > 0) {
      throw new BadRequestException(
        `Já existe cobrança em aberto para: ${nomesDe(emAberto)}. Cancele o pedido anterior antes de emitir outro.`
      )
    }
    // Cortesia ativa (acesso liberado antes de cobrar) e cancelada NÃO barram: a criação
    // reaproveita a linha, ligando-a ao pedido novo.
    const reaproveitar = existentes.filter((e) => (e.status === 'active' && e.source === 'free') || e.status === 'canceled')

    // Preço promocional vence, igual à vitrine — cobrar o cheio geraria boleto divergente
    // do que o aluno viu no site.
    const total = cursos.reduce((soma, c) => soma + (c.promo != null && c.promo < c.price ? c.promo : c.price), 0)
    if (total <= 0) throw new BadRequestException('Os cursos escolhidos somam zero — use cobrança avulsa.')
    return { total, descricao: cursos.map((c) => c.title).join(' + '), cursos, reaproveitar }
  }

  /** Grava as parcelas do carnê recém-criado, para a ficha do aluno já mostrá-las. */
  private async gravarParcelas(orderId: string, installmentId: string): Promise<void> {
    const pagamentos = await this.asaas.listInstallmentPayments(installmentId)
    if (pagamentos.length === 0) return
    await this.db.insert(orderInstallments).values(
      pagamentos.map((p, i) => ({
        id: randomUUID(),
        orderId,
        asaasChargeId: p.id,
        installmentNumber: p.installmentNumber ?? i + 1,
        valueInCents: Math.round((p.value ?? 0) * 100),
        status: 'pending' as const,
        dueDate: p.dueDate ?? null,
      }))
    )
  }

  /**
   * Cancela a cobrança NO ASAAS e no nosso banco, nesta ordem.
   *
   * O cancelamento que já existia só marcava o pedido aqui: o boleto continuava vivo e o
   * aluno podia pagar algo que o admin achava excluído. Cancelar lá PRIMEIRO é o que torna
   * a operação honesta — se o Asaas recusar (cobrança já paga), nada é marcado aqui e o
   * admin vê o erro, em vez de ficar com o banco dizendo uma coisa e o dinheiro outra.
   */
  async cancelCharge(tenantId: string, orderId: string): Promise<{ jaEstavaCancelado: boolean }> {
    const rows = await this.db
      .select({
        id: orders.id,
        status: orders.status,
        chargeId: orders.asaasChargeId,
        installmentId: orders.asaasInstallmentId,
      })
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)))
      .limit(1)
    const o = rows[0]
    if (!o) throw new NotFoundException('Pedido não encontrado.')
    if (o.status === 'canceled') return { jaEstavaCancelado: true }
    if (o.status === 'paid') {
      throw new BadRequestException('Pedido já pago não pode ser cancelado aqui — trate o estorno pelo Asaas.')
    }

    // Carnê: apaga o PLANO, que leva junto todos os boletos em aberto. Apagar boleto a
    // boleto deixaria o plano vivo, gerando os próximos.
    if (o.installmentId) await this.asaas.deleteInstallment(o.installmentId)
    else if (o.chargeId) await this.asaas.deleteCharge(o.chargeId)

    const now = new Date()
    await this.db.update(orders).set({ status: 'canceled', updatedAt: now }).where(eq(orders.id, orderId))
    await this.db
      .update(enrollments)
      .set({ status: 'canceled', updatedAt: now })
      .where(eq(enrollments.orderId, orderId))
    return { jaEstavaCancelado: false }
  }

  /**
   * PDF do boleto/carnê para o ADMIN baixar. Carnê devolve o livro inteiro; à vista, a
   * fatura da cobrança. Só existe depois que o Asaas confirmou a criação.
   */
  async boletoFor(tenantId: string, orderId: string): Promise<Buffer> {
    const rows = await this.db
      .select({ installmentId: orders.asaasInstallmentId, chargeId: orders.asaasChargeId })
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)))
      .limit(1)
    const o = rows[0]
    if (!o) throw new NotFoundException('Pedido não encontrado.')
    if (o.installmentId) return this.asaas.getPaymentBook(o.installmentId)
    throw new BadRequestException(
      'Este pedido não é carnê. Use o link da fatura para abrir o boleto no Asaas.'
    )
  }
}
