import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { and, eq, isNotNull, isNull, or } from 'drizzle-orm'
import type { AsaasReconcileResult, InstallmentStatus } from '@pilari/types'
import { enrollments, orders } from '../../db/schema'
import type { Database } from '../../db/types'
import { EarningsService } from '../finance/earnings.service'
import { AuditService } from '../audit/audit.service'
import { TenantMembersService } from '../tenancy/tenant-members.service'
import { AsaasService } from './asaas.service'
import { InstallmentsService } from './installments.service'
import { PAID_STATUSES } from './payment-status'

/**
 * Eventos que mexem em alguma coisa. Os demais saem antes de qualquer I/O: o Asaas dispara
 * dezenas de eventos por cobrança (PAYMENT_CREATED, PAYMENT_UPDATED, ...) e reconsultar a API
 * para depois ignorá-los custaria uma chamada externa — e um 500 (com retry do Asaas) sempre
 * que a consulta falhasse — por evento que nunca teve ação.
 */
const HANDLED_EVENTS = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_OVERDUE', 'PAYMENT_REFUNDED'])

/** Taxa do Asaas em centavos a partir de value/netValue (em reais). null se desconhecida. */
function feeCentsFrom(value?: number | null, netValue?: number | null): number | null {
  if (typeof value !== 'number' || typeof netValue !== 'number') return null
  const fee = Math.round((value - netValue) * 100)
  return fee >= 0 ? fee : null
}

/** Tamanho de página das varreduras de reconciliação. Exportado só para o teste de paginação. */
export const RECONCILE_PAGE_SIZE = 200
/**
 * Trava de segurança da paginação: nenhuma varredura busca mais que
 * `RECONCILE_PAGE_SIZE * RECONCILE_MAX_PAGES` pedidos numa única rodada, por maior que seja
 * a fila. Nenhuma escola real chega perto de 10.000 pedidos pending/carnê ao mesmo tempo — o
 * limite existe só para um bug de paginação (ou uma consulta que nunca encolhe) não girar
 * para sempre num cron diário.
 */
const RECONCILE_MAX_PAGES = 50

/** Processa eventos do Asaas por PEDIDO. Repetível (idempotente). */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name)
  constructor(
    @Inject('DB_CLIENT') private readonly db: Database,
    private readonly earnings: EarningsService,
    private readonly audit: AuditService,
    private readonly asaas: AsaasService,
    private readonly installments: InstallmentsService,
    private readonly members: TenantMembersService
  ) {}

  /**
   * Localiza o pedido de um pagamento, do vínculo mais confiável para o mais frágil.
   *
   * 1) a PARCELA: as parcelas do carnê são gravadas no checkout, então qualquer cobrança dele
   *    resolve localmente, sem depender de o Asaas propagar campo nenhum. É o único caminho
   *    que alcança as parcelas 2..N — as outras buscas nunca casam com elas.
   * 2) o `externalReference` (o nosso orderId, enviado na criação do link);
   * 3) o id do link, porque a doc do Asaas não garante que o pagamento gerado por um link
   *    herde o externalReference dele;
   * 4) o `asaasChargeId` do pedido, gravado na liberação — cobre pedidos antigos, liberados
   *    antes de existirem os caminhos 1 e 2 (era por aqui que o refund achava o pedido).
   */
  private async findOrder(
    chargeId: string,
    payment: { externalReference: string | null; paymentLink: string | null }
  ) {
    const byInstallment = await this.installments.findOrderIdByCharge(chargeId)
    if (byInstallment) {
      const rows = await this.db.select().from(orders).where(eq(orders.id, byInstallment)).limit(1)
      if (rows[0]) return rows[0]
    }
    if (payment.externalReference) {
      const byRef = await this.db.select().from(orders).where(eq(orders.id, payment.externalReference)).limit(1)
      if (byRef[0]) return byRef[0]
    }
    if (payment.paymentLink) {
      const byLink = await this.db.select().from(orders).where(eq(orders.asaasPaymentLinkId, payment.paymentLink)).limit(1)
      if (byLink[0]) return byLink[0]
    }
    const byCharge = await this.db.select().from(orders).where(eq(orders.asaasChargeId, chargeId)).limit(1)
    return byCharge[0] ?? null
  }

  async handleEvent(event: string, charge: { id: string; status: string }): Promise<void> {
    if (!HANDLED_EVENTS.has(event)) {
      this.logger.log(`Webhook ${event} sem ação na matrícula — ignorado`)
      return
    }
    // NUNCA confiamos no payload do webhook: o token seria o único fator e, se vazar, forja-se
    // "pago" com valor arbitrário. Reconsultamos o Asaas — a fonte de verdade — ANTES até de
    // saber de que pedido se trata. O token vira gatilho, não autorização.
    const payment = await this.asaas.getPayment(charge.id)
    const order = await this.findOrder(charge.id, payment)
    if (!order) {
      this.logger.warn(`Webhook ${event}: pagamento ${charge.id} sem pedido correspondente — ignorado`)
      return
    }

    // Anti-replay. Antes esse papel era feito de carona pelo guarda `status !== 'pending'` de
    // releaseIfPaid; num carnê o pedido fica `paid` da 2a parcela em diante, então aquele guarda
    // não pode mais interromper o fluxo — o cancelamento passa a ser barrado aqui, explicitamente.
    if (order.status === 'canceled') {
      this.logger.log(`Webhook ${event}: pedido ${order.id} cancelado — ignorado`)
      return
    }

    // Um pedido com plano de parcelamento no Asaas é um carnê; sem, é à vista/cartão.
    const isCarne = !!order.asaasInstallmentId

    if (event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_RECEIVED') {
      // O status vem do getPayment, nunca do evento: sem isto, um webhook forjado marcaria a
      // parcela paga e capturaria o ganho de um boleto que o Asaas nem considera pago.
      if (!PAID_STATUSES.has(payment.status)) {
        this.logger.warn(`Webhook ${event}: Asaas ainda não confirmou ${payment.id} (${payment.status}) — ignorado`)
        return
      }
      if (isCarne) {
        await this.markInstallment(order.id, payment.id, 'paid', {
          paidAt: new Date(),
          feeInCents: feeCentsFrom(payment.value, payment.netValue),
        })
      }
      // Acesso no CONFIRMED (o aluno pagou); dinheiro no RECEIVED (caiu na conta). Só a
      // primeira parcela libera de fato — releaseIfPaid é no-op num pedido que já está pago.
      await this.releaseIfPaid(order, payment)
      if (isCarne && event === 'PAYMENT_RECEIVED') {
        // Ganho por PARCELA, com a taxa real daquele boleto (o Asaas cobra tarifa por boleto
        // pago: um carnê de 5x incorre em 5 tarifas, nunca a "tarifa do pedido").
        await this.earnings.captureForInstallment(
          order.id,
          payment.id,
          Math.round((payment.value ?? 0) * 100),
          feeCentsFrom(payment.value, payment.netValue)
        )
        await this.settleIfComplete(order)
      }
      return
    }

    // Rebaixar (vencer/estornar) uma cobrança que o Asaas ainda dá como paga seria desfazer,
    // por um evento avulso, o que a fonte de verdade afirma — e num pedido à vista isso
    // revogaria o acesso do aluno.
    if (PAID_STATUSES.has(payment.status)) {
      this.logger.warn(`Webhook ${event}: Asaas ainda dá ${payment.id} como ${payment.status} — ignorado`)
      return
    }

    if (event === 'PAYMENT_OVERDUE') {
      if (isCarne) await this.markInstallment(order.id, payment.id, 'overdue')
      // Decisão do dono: inadimplência NÃO retira o acesso ao conteúdo. Matrícula não se toca.
      return
    }

    if (event === 'PAYMENT_REFUNDED') {
      if (isCarne) {
        // Estorno de UMA parcela não é cancelamento do pedido: cancelar revogaria o acesso de
        // quem pagou 4 de 5. O pedido apenas deixa de estar quitado.
        await this.markInstallment(order.id, payment.id, 'refunded')
        await this.db.update(orders).set({ settledAt: null, updatedAt: new Date() }).where(eq(orders.id, order.id))
        // "Carnê com ZERO parcelas pagas líquidas" não é inadimplência: é o cancelamento à
        // vista com outro nome — o aluno pagou o boleto 1, ganhou o acesso, estornou, e não
        // deve mais nada. A regra "inadimplência não tira acesso" continua valendo (não
        // revogamos nada automaticamente), mas esse caso não pode seguir invisível: sem este
        // aviso o aluno fica com o curso inteiro de graça e ninguém fica sabendo.
        const aindaPagas = await this.installments.paidChargeIds(order.id)
        if (aindaPagas.size === 0) {
          this.logger.warn(
            `Pedido ${order.id}: estorno da parcela ${payment.id} deixou o carnê SEM NENHUMA parcela paga — acesso segue liberado; revise e cancele manualmente se for o caso`
          )
        } else {
          this.logger.log(`Pedido ${order.id}: parcela ${payment.id} estornada — acesso preservado`)
        }
        return
      }
      // Só a cobrança que QUITOU o pedido pode cancelá-lo. Antes isso era estrutural: os eventos
      // não-confirmatórios buscavam o pedido por `orders.asaas_charge_id`, então nenhuma outra
      // cobrança chegava aqui. Agora que findOrder acha o pedido por externalReference/link, uma
      // cobrança IRMÃ (segundo clique no link de pagamento, nunca paga) alcançaria applyCanceled
      // e revogaria o acesso de um aluno que pagou — o gate de "não rebaixar o que está pago" não
      // pega esse caso, porque a irmã abandonada vem PENDING/OVERDUE.
      if (order.asaasChargeId !== payment.id) {
        this.logger.warn(
          `Webhook ${event}: ${payment.id} não é a cobrança que pagou o pedido ${order.id} (${order.asaasChargeId ?? 'nenhuma'}) — ignorado`
        )
        return
      }
      await this.applyCanceled(order.id)
      return
    }

    // Default deste método é NÃO FAZER NADA. Um evento novo em HANDLED_EVENTS que caísse aqui por
    // fall-through cancelaria pedidos — por isso cada evento tem seu `if` explícito.
    this.logger.log(`Webhook ${event} sem ação na matrícula — ignorado`)
  }

  /**
   * markStatus com o "não achei a parcela" no log. Sem isto o carnê pode nunca quitar em
   * silêncio: o ganho é capturado, mas nenhuma linha de order_installments vira `paid`.
   */
  private async markInstallment(
    orderId: string,
    chargeId: string,
    status: InstallmentStatus,
    extra?: { paidAt?: Date; feeInCents?: number | null }
  ): Promise<void> {
    const changed = await this.installments.markStatus(chargeId, status, extra)
    if (!changed) {
      this.logger.warn(
        `Pedido ${orderId}: cobrança ${chargeId} não tem parcela em order_installments — status "${status}" não foi gravado e o carnê não vai quitar sozinho`
      )
    }
  }

  /**
   * Carimba settled_at quando todas as parcelas contratadas estão pagas. Devolve se quitou
   * AGORA (usado pela reconciliação de carnês para contar quantos certificados destravaram
   * nesta rodada) — os chamadores que só querem o efeito colateral seguem livres pra ignorar.
   */
  private async settleIfComplete(order: { id: string; installmentCount: number | null }): Promise<boolean> {
    const total = order.installmentCount ?? 0
    if (!total) return false
    if (!(await this.installments.isSettled(order.id, total))) return false
    await this.db.update(orders).set({ settledAt: new Date(), updatedAt: new Date() }).where(eq(orders.id, order.id))
    this.logger.log(`Pedido ${order.id}: carnê quitado`)
    return true
  }

  /**
   * Libera o pedido quando o Asaas confirma um pagamento QUE PERTENCE ÀQUELE PEDIDO.
   *
   * A âncora de confiança é a PROCEDÊNCIA, não o valor: numa compra em 10x a parcela vale
   * um décimo do pedido, então comparar valor com total rejeitaria toda venda parcelada.
   * A propriedade de segurança se mantém porque o valor do link foi definido por nós na
   * criação — quem tiver o token do webhook não forja um pagamento de R$ 0,01, teria que
   * forjar um link nosso (ver findOrder). Idempotente: só transiciona `pending → paid`, então
   * evento repetido não reativa. O anti-replay de pedido cancelado mora em handleEvent — aqui
   * ele não caberia mais, porque num carnê o pedido está `paid` da 2a parcela em diante.
   */
  private async releaseIfPaid(
    order: { id: string; tenantId: string; userId: string; status: string; totalInCents: number; asaasInstallmentId?: string | null },
    payment: { id: string; status: string; value: number | null; netValue: number | null; billingType: string | null; installmentCount: number | null }
  ): Promise<boolean> {
    if (order.status !== 'pending') {
      this.logger.log(`Pedido ${order.id} não está pending (${order.status}) — liberação ignorada`)
      return false
    }
    if (!PAID_STATUSES.has(payment.status)) return false
    // Não barra (parcela é fração legítima do total), mas deixa rastro se um pagamento à
    // vista vier abaixo do vendido — seria sinal de cobrança criada fora do nosso fluxo.
    if (typeof payment.value === 'number' && Math.round(payment.value * 100) < order.totalInCents) {
      this.logger.warn(
        `Pedido ${order.id}: pagamento ${payment.id} de R$ ${payment.value} abaixo do total de R$ ${(order.totalInCents / 100).toFixed(2)} — esperado em compra parcelada`
      )
    }
    // Num carnê o pedido fica pago já na 1a parcela (o aluno estuda desde então), mas quitado
    // só quando a última cair — quem carimba settled_at ali é settleIfComplete. E o total de
    // parcelas é o do checkout: `installmentCount` ausente diz a applyPaid para não mexer nele.
    const isCarne = !!order.asaasInstallmentId
    await this.applyPaid(
      order,
      feeCentsFrom(payment.value, payment.netValue),
      {
        asaasChargeId: payment.id,
        billingType: payment.billingType,
        installmentCount: isCarne ? undefined : payment.installmentCount,
      },
      !isCarne
    )
    // Carnê captura por parcela, no PAYMENT_RECEIVED. Chamar captureForOrder aqui creditaria o
    // instrutor com o pedido INTEIRO na primeira parcela, somado às cinco parcelas — até 200%.
    if (!isCarne) await this.earnings.captureForOrder(order.id)
    // tenantId do PEDIDO, não de quem aciona (webhook do Asaas e reconciliação não têm polo
    // de requisição) — é o pedido que sabe a que polo pertence.
    this.audit.log({ tenantId: order.tenantId, actorUid: null, actorEmail: null, action: 'order.paid', summary: `Pedido ${order.id} pago (${(order.totalInCents / 100).toFixed(2)})`, targetType: 'order', targetId: order.id })
    return true
  }

  /**
   * Marca pedido pago (+ taxa e dados do pagamento) + ativa matrículas. Idempotente.
   *
   * `settleNow` diz se ESTE pagamento já quita o pedido — verdade para tudo que entra de uma vez
   * (à vista, cartão, baixa manual) e falso no carnê, onde settled_at só sai na última parcela
   * (settleIfComplete). Ele governa o carimbo de settled_at, e só isso: quem decide o total de
   * parcelas é quem chama, omitindo `found.installmentCount` para dizer "não mexe". Num carnê
   * esse total veio do checkout, e o pagamento de uma parcela traz `installmentNumber` mas nem
   * sempre `installmentCount` — sobrescrever com null faria settleIfComplete desistir e o carnê
   * nunca quitar.
   *
   * A captura de ganhos NÃO mora mais aqui — quem chama decide, porque carnê captura por
   * parcela e um captureForOrder aqui creditaria o pedido inteiro por cima disso.
   */
  private async applyPaid(
    order: { id: string; tenantId: string; userId: string },
    asaasFeeInCents?: number | null,
    found?: { asaasChargeId: string; billingType: string | null; installmentCount?: number | null },
    settleNow = true
  ): Promise<void> {
    const orderId = order.id
    const now = new Date()
    const base: Record<string, unknown> = { status: 'paid', paidAt: now, updatedAt: now }
    if (settleNow) base.settledAt = now
    if (asaasFeeInCents != null) base.asaasFeeInCents = asaasFeeInCents
    // Só descobrimos qual pagamento pagou o pedido agora — o link não tem chargeId na criação.
    if (found) {
      base.asaasChargeId = found.asaasChargeId
      base.billingType = found.billingType
      // `undefined` (ausente) = preserva o que está gravado; `null` = grava null de propósito
      // (pagamento à vista não inventa 1x).
      if (found.installmentCount !== undefined) base.installmentCount = found.installmentCount
    }
    await this.db.update(orders).set(base).where(eq(orders.id, orderId))
    // idempotente: ativar matrículas já ativas é inofensivo
    await this.db.update(enrollments).set({ status: 'active', activatedAt: now, updatedAt: now }).where(eq(enrollments.orderId, orderId))
    await this.garantirVinculo(order.tenantId, order.userId)
  }

  /**
   * Pedido liberado garante o vínculo de aluno do comprador no polo do PEDIDO (B3), como a cortesia; nunca para admin da
   * plataforma. Uma falha aqui não desfaz a liberação: vai para o log, e o próximo login do aluno cria o vínculo.
   */
  private async garantirVinculo(tenantId: string, userId: string): Promise<void> {
    try {
      await this.members.ensureStudentUnlessPlatform(tenantId, userId)
    } catch (e) {
      this.logger.error(`Vínculo de aluno do comprador ${userId} no polo ${tenantId} não foi criado: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /** Cancela pedido + matrículas. */
  private async applyCanceled(orderId: string): Promise<void> {
    const now = new Date()
    await this.db.update(orders).set({ status: 'canceled', updatedAt: now }).where(eq(orders.id, orderId))
    await this.db.update(enrollments).set({ status: 'canceled', updatedAt: now }).where(eq(enrollments.orderId, orderId))
  }

  /**
   * Busca todas as páginas de uma consulta, sem depender de um `.limit()` fixo — um carnê em
   * curso por meses (ou uma fila de pending grande) não pode mais crescer a ponto de deixar
   * pedidos de fora da varredura pra sempre. `RECONCILE_MAX_PAGES` é só a trava de segurança.
   */
  private async fetchAllPages<T>(page: (limit: number, offset: number) => Promise<T[]>): Promise<T[]> {
    const all: T[] = []
    for (let i = 0; i < RECONCILE_MAX_PAGES; i++) {
      const rows = await page(RECONCILE_PAGE_SIZE, i * RECONCILE_PAGE_SIZE)
      all.push(...rows)
      if (rows.length < RECONCILE_PAGE_SIZE) break // última página (ou vazia): não tem mais o que buscar
    }
    return all
  }

  /**
   * Pedidos `pending` que têm ALGUMA âncora no Asaas — ainda esperando a 1a confirmação.
   *
   * O `or` não é folga: o checkout grava `asaasPaymentLinkId` só no ramo à vista/cartão; no
   * carnê ele fica NULO e a âncora é o `asaasInstallmentId`. Exigir o link (como era antes)
   * deixava todo carnê `pending` fora desta varredura — e a de carnês abaixo exige `paid`, de
   * modo que um carnê cuja 1a parcela foi paga com o webhook perdido (deploy no meio, getPayment
   * falhando) não aparecia em varredura NENHUMA: o aluno pagava, as matrículas ficavam `pending`
   * para sempre e nem o cron diário nem o botão "Reconciliar Asaas" do admin o alcançavam.
   */
  private async fetchPendingWithLinkOrCarne() {
    return this.fetchAllPages((limit, offset) =>
      this.db
        .select({
          id: orders.id,
          tenantId: orders.tenantId,
          // o comprador: a liberação garante o vínculo de aluno dele no polo do pedido (B3)
          userId: orders.userId,
          asaasPaymentLinkId: orders.asaasPaymentLinkId,
          status: orders.status,
          totalInCents: orders.totalInCents,
          // sem isto a reconciliação de um carnê cairia no captureForOrder (ganho do pedido inteiro)
          asaasInstallmentId: orders.asaasInstallmentId,
        })
        .from(orders)
        .where(
          and(
            eq(orders.status, 'pending'),
            or(isNotNull(orders.asaasPaymentLinkId), isNotNull(orders.asaasInstallmentId))
          )
        )
        // MySQL não garante ordem nenhuma sem ORDER BY: sem isto, uma escrita concorrente
        // entre páginas pode fazer uma linha pular a varredura inteira (perde 1 dia, não mais).
        .orderBy(orders.id)
        .limit(limit)
        .offset(offset)
    )
  }

  /**
   * Carnês `paid` ainda não quitados: a 1a parcela já liberou o pedido (por isso não aparecem
   * mais na varredura de `pending` acima), mas faltam parcelas — cada uma dependendo de um
   * webhook que pode se perder por meses até a última cair.
   */
  private async fetchOpenCarnes() {
    return this.fetchAllPages((limit, offset) =>
      this.db
        .select({
          id: orders.id,
          asaasInstallmentId: orders.asaasInstallmentId,
          installmentCount: orders.installmentCount,
        })
        .from(orders)
        .where(and(eq(orders.status, 'paid'), isNull(orders.settledAt), isNotNull(orders.asaasInstallmentId)))
        // mesma razão do orderBy acima: sem ordem estável, paginação + escrita concorrente pode
        // pular um pedido entre páginas.
        .orderBy(orders.id)
        .limit(limit)
        .offset(offset)
    )
  }

  /**
   * Varredura de pedidos `pending`: lista os pagamentos do pedido no Asaas e libera se algum
   * já foi pago — recupera eventos de webhook perdidos (boleto pago enquanto o webhook estava
   * fora do ar). Reusa o caminho idempotente de releaseIfPaid, então é seguro rodar de novo.
   *
   * Varre por `asaasPaymentLinkId`/`asaasInstallmentId` e não por `asaasChargeId` porque o
   * pagamento só passa a existir depois que o aluno paga: antes disso o pedido não tem chargeId
   * nenhum, e a varredura antiga não enxergaria pedido algum.
   *
   * Num carnê `pending` este sweep faz SÓ a liberação do acesso (releaseIfPaid já reconhece o
   * carnê e não carimba settled_at nem captura o ganho do pedido inteiro). O registro das
   * parcelas e a captura do ganho DAQUELA parcela ficam com reconcileCarneSweep, que roda logo
   * em seguida na MESMA rodada — ver a INVARIANTE DE ORDEM em reconcilePending.
   *
   * Depende do pagamento herdar o `externalReference` do link — ainda não confirmado com
   * pagamento real. Enquanto isso, o webhook (que tem plano B pelo id do link) é o caminho
   * principal e a baixa manual do admin é a rede de segurança.
   */
  private async reconcilePendingSweep(
    pend: Array<{
      id: string
      tenantId: string
      userId: string
      asaasPaymentLinkId: string | null
      status: string
      totalInCents: number
      asaasInstallmentId: string | null
    }>
  ): Promise<{ reconciled: number; stillPending: number; failed: number }> {
    let reconciled = 0
    let stillPending = 0
    let failed = 0
    for (const o of pend) {
      try {
        const payments = await this.asaas.listPaymentsByExternalReference(o.id)
        let released = false
        // Sem `break`: nada garante que exista só UM pagamento pago para este externalReference
        // (ex.: link clicado duas vezes e as duas cobranças pagas). releaseIfPaid só libera de
        // fato uma vez (guarda `status !== 'pending'`); as demais chamadas são idempotentes —
        // ver a UNIQUE de captureForOrder.
        for (const p of payments) {
          if (await this.releaseIfPaid(o, p)) released = true
        }
        if (released) reconciled++
        else stillPending++
      } catch (e) {
        this.logger.warn(`Reconcile falhou p/ pedido ${o.id}: ${String(e)}`)
        failed++
      }
    }
    return { reconciled, stillPending, failed }
  }

  /**
   * Varredura de carnês `paid` sem `settled_at`: para cada um, lista as parcelas do plano no
   * Asaas e, para cada uma que o Asaas já dá como paga E ainda não está marcada localmente,
   * captura o ganho e SÓ DEPOIS marca (via markInstallment — nunca markStatus direto, é ele
   * quem loga a parcela órfã).
   *
   * A ORDEM (captura, depois marca) é o que torna uma falha retentável. captureForInstallment
   * é idempotente (UNIQUE em order_id+course_id+asaas_charge_id): repeti-la de graça não custa
   * nada. markStatus é quem faz a parcela sumir do filtro `paidChargeIds` abaixo — é ele quem
   * TRAVA a rodada de amanhã fora desta parcela. Se a ordem fosse invertida (marcar primeiro),
   * uma falha na captura (deadlock, blip de rede) deixaria a parcela `paid` localmente com o
   * ganho NUNCA capturado — e como ela já não apareceria mais em `paidChargeIds` como
   * "pendente de captura", nenhuma rodada futura a revisitaria: o instrutor ficaria sub-pago
   * pra sempre, em silêncio, e o único rastro seria uma linha de WARN no log de hoje.
   *
   * `recordFromPayments` roda ANTES do filtro `paidChargeIds` (não depois): o checkout tolera
   * falhar a listagem das parcelas na criação (ver checkout.service.ts), prometendo que "a
   * reconciliação recupera depois" — mas markStatus só faz UPDATE, nunca INSERT. Sem
   * recordFromPayments aqui, um pedido cujo checkout falhou nunca teria linha em
   * order_installments, markInstallment avisaria "parcela órfã" todo santo dia, para sempre, e
   * isSettled jamais bateria com installmentCount: o único caso em que o certificado fica
   * PRESO DE VERDADE (não só atrasado um dia). `recordFromPayments` é idempotente (UNIQUE em
   * asaas_charge_id; `ON DUPLICATE KEY UPDATE id = id` nunca rebaixa um status já avançado),
   * então rodar todo dia é seguro. Precisa vir DEPOIS de calcular `jaMarcadas`: se o Asaas já
   * dá uma parcela como paga e o INSERT a grava como `paid` na hora, ela entraria no filtro
   * como "já processada" e sua captura de ganho seria pulada PARA SEMPRE — por isso
   * `jaMarcadas` reflete o estado ANTES deste INSERT, nunca depois.
   *
   * SEM `break`: um carnê pode ter várias parcelas novas para conciliar de uma vez — é
   * exatamente o gap que este sweep fecha (o laço antigo parava no primeiro pagamento
   * liberado). settleIfComplete roda uma vez por pedido, depois de tratar todas as parcelas.
   */
  private async reconcileCarneSweep(
    carnes: Array<{ id: string; asaasInstallmentId: string | null; installmentCount: number | null }>
  ): Promise<{ installmentsReconciled: number; settled: number; failed: number }> {
    let installmentsReconciled = 0
    let settled = 0
    let failed = 0
    for (const o of carnes) {
      try {
        // listInstallmentPayments nunca lança (contrato do AsaasService): falha de rede vira
        // lista vazia, e o carnê só é revisitado na próxima rodada — não pode abortar o sweep.
        const parcelas = await this.asaas.listInstallmentPayments(o.asaasInstallmentId!)
        const pagas = parcelas.filter((p) => PAID_STATUSES.has(p.status))
        // Só consulta o que já está gravado quando há algo pago pra conferir — no estado
        // estacionário (esperando a próxima data de vencimento) não gasta a query à toa.
        // ANTES do recordFromPayments — ver o porquê no comentário do método.
        const jaMarcadas = pagas.length ? await this.installments.paidChargeIds(o.id) : new Set<string>()
        await this.installments.recordFromPayments(o.id, parcelas)
        for (const p of pagas) {
          if (jaMarcadas.has(p.id)) continue
          await this.earnings.captureForInstallment(o.id, p.id, Math.round((p.value ?? 0) * 100), feeCentsFrom(p.value, p.netValue))
          await this.markInstallment(o.id, p.id, 'paid', {
            paidAt: new Date(),
            feeInCents: feeCentsFrom(p.value, p.netValue),
          })
          installmentsReconciled++
        }
        if (await this.settleIfComplete(o)) settled++
      } catch (e) {
        this.logger.warn(`Reconcile de carnê falhou p/ pedido ${o.id}: ${String(e)}`)
        failed++
      }
    }
    return { installmentsReconciled, settled, failed }
  }

  /**
   * Reconciliação (pull): rede de segurança para webhook perdido. Duas varreduras — pedidos
   * `pending` com link OU carnê (1a confirmação) e carnês `paid` ainda em aberto (parcelas 2..N)
   * — porque um carnê sai de `pending` já na 1a parcela e fica `paid` por meses esperando as
   * demais; sem a segunda varredura, nada recuperaria uma dessas parcelas se o webhook dela se
   * perdesse, e o aluno pagaria o carnê inteiro sem nunca destravar o certificado.
   */
  async reconcilePending(): Promise<AsaasReconcileResult> {
    const pend = await this.fetchPendingWithLinkOrCarne()
    const { reconciled, stillPending, failed: pendingFailed } = await this.reconcilePendingSweep(pend)

    // INVARIANTE DE ORDEM — não hoiste, não paralelize: fetchOpenCarnes() tem que rodar DEPOIS
    // que reconcilePendingSweep já aplicou suas liberações (releaseIfPaid/applyPaid). Um carnê
    // cuja 1a parcela é liberada agora mesmo, pela varredura acima, sai do filtro `pending` e
    // já bate no filtro `paid + settled_at null` desta segunda busca — sequencial, ele é
    // conciliado NA MESMA rodada. "Buscar as duas listas primeiro, depois varrer" parece uma
    // otimização inofensiva (e um Promise.all pareceria ainda mais inofensivo), mas faria essa
    // busca rodar contra o pedido ainda `pending`: ele simplesmente não apareceria aqui, e só
    // seria conciliado no cron de amanhã — um dia a mais com o certificado preso sem motivo.
    const carnes = await this.fetchOpenCarnes()
    const { installmentsReconciled, settled, failed: carneFailed } = await this.reconcileCarneSweep(carnes)

    const checked = pend.length + carnes.length
    const failed = pendingFailed + carneFailed
    this.logger.log(
      `Reconcile Asaas: checked=${checked} reconciled=${reconciled} stillPending=${stillPending} failed=${failed} installmentsReconciled=${installmentsReconciled} settled=${settled}`
    )
    return { checked, reconciled, stillPending, failed, installmentsReconciled, settled }
  }

  /**
   * Baixa manual (admin): marca o pedido como pago pelo ID — sem depender do Asaas
   * (pagou por outro meio, ou o webhook falhou). Reusa applyPaid (idempotente).
   */
  async settleManually(orderId: string): Promise<{ alreadyPaid: boolean }> {
    const rows = await this.db
      .select({ id: orders.id, tenantId: orders.tenantId, userId: orders.userId, status: orders.status, asaasInstallmentId: orders.asaasInstallmentId })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1)
    const order = rows[0]
    if (!order) throw new NotFoundException('Pedido não encontrado.')
    if (order.status === 'paid') return { alreadyPaid: true }
    // Quita SÓ o que entra de uma vez. Num carnê a baixa manual libera o acesso da 1a parcela
    // e nada mais: carimbar settled_at aqui destravaria o certificado com 4 de 5 parcelas em
    // aberto E tiraria o pedido de fetchOpenCarnes (que exige settled_at IS NULL), de modo que
    // nenhuma parcela futura seria reconciliada. Quitar um carnê é operação PRÓPRIA
    // (settleCarneManually), oferecida só quando o pedido já está `paid`.
    await this.applyPaid(order, undefined, undefined, !order.asaasInstallmentId)
    // Num carnê o ganho já foi (ou será) capturado parcela a parcela; captureForOrder aqui
    // somaria o pedido INTEIRO por cima disso. Sem crédito automático, e com aviso no log.
    if (order.asaasInstallmentId) {
      this.logger.warn(`Baixa manual do carnê ${order.id}: ganhos das parcelas não pagas NÃO foram capturados`)
    } else {
      await this.earnings.captureForOrder(order.id)
    }
    this.logger.log(`Baixa manual: pedido ${order.id} marcado como pago`)
    return { alreadyPaid: false }
  }

  /**
   * Quitação manual de um carnê (admin): carimba `settled_at` sem passar pelo Asaas — o aluno
   * pagou o resto por fora, renegociou, ou um webhook de uma parcela se perdeu. Diferente de
   * `settleManually`: aqui o pedido JÁ é `paid` (é exatamente o estado que aquele recusa) — um
   * carnê libera acesso na 1a parcela e fica `paid` por meses até a última cair, e sem esta
   * operação esse período inteiro não tinha NENHUMA baixa manual possível.
   *
   * Idempotente pelo próprio dado: `settled_at` não-nulo é o sinal de "já quitado", então
   * rodar de novo é no-op (sem novo UPDATE, sem novo carimbo de data).
   */
  async settleCarneManually(orderId: string): Promise<{ alreadySettled: boolean }> {
    const rows = await this.db
      .select({ id: orders.id, status: orders.status, settledAt: orders.settledAt })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1)
    const order = rows[0]
    if (!order) throw new NotFoundException('Pedido não encontrado.')
    if (order.status !== 'paid') {
      throw new BadRequestException('Só é possível quitar manualmente um pedido já pago (acesso liberado).')
    }
    if (order.settledAt) return { alreadySettled: true }
    await this.db.update(orders).set({ settledAt: new Date(), updatedAt: new Date() }).where(eq(orders.id, orderId))
    this.logger.log(`Quitação manual do carnê: pedido ${order.id} marcado como quitado`)
    return { alreadySettled: false }
  }

  /** Cancelamento manual (admin) de um pedido pelo ID. */
  async cancelManually(orderId: string): Promise<{ alreadyCanceled: boolean }> {
    const rows = await this.db.select({ id: orders.id, status: orders.status }).from(orders).where(eq(orders.id, orderId)).limit(1)
    const order = rows[0]
    if (!order) throw new NotFoundException('Pedido não encontrado.')
    if (order.status === 'canceled') return { alreadyCanceled: true }
    await this.applyCanceled(order.id)
    this.logger.log(`Cancelamento manual: pedido ${order.id}`)
    return { alreadyCanceled: false }
  }
}
