/// <reference types="jest" />
import { Logger } from '@nestjs/common'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import type { SQL } from 'drizzle-orm'
import { createDrizzleMock, withQueryResults, type DrizzleMock } from '../../__test-utils__/drizzle-mock'
import { enrollments, orders } from '../../db/schema'
import { RECONCILE_PAGE_SIZE, WebhookService } from './webhook.service'

function make() {
  const db: DrizzleMock = createDrizzleMock()
  const earnings = {
    captureForOrder: jest.fn(async () => undefined),
    captureForInstallment: jest.fn(async () => undefined),
  }
  const audit = { log: jest.fn() }
  // O retorno é anotado porque `async () => []` inferiria never[] e impediria mockResolvedValue.
  const asaas = {
    getPayment: jest.fn(),
    listPaymentsByExternalReference: jest.fn(async (): Promise<Record<string, unknown>[]> => []),
    listInstallmentPayments: jest.fn(async (): Promise<Record<string, unknown>[]> => []),
  }
  const installments = {
    // devolve `true` = "achei a parcela e atualizei" (ver InstallmentsService.markStatus)
    markStatus: jest.fn(async () => true),
    findOrderIdByCharge: jest.fn(async (): Promise<string | null> => null),
    isSettled: jest.fn(async () => false),
    // vazio por padrão: nenhuma parcela já processada localmente, salvo o teste que diz o contrário
    paidChargeIds: jest.fn(async (): Promise<Set<string>> => new Set()),
    recordFromPayments: jest.fn(async () => undefined),
  }
  const members = { ensureStudentUnlessPlatform: jest.fn(async (): Promise<void> => undefined) }
  return {
    db,
    asaas,
    earnings,
    audit,
    installments,
    members,
    service: new WebhookService(db as never, earnings as never, audit as never, asaas as never, installments as never, members as never),
  }
}

/**
 * Cenário de carnê: o pedido é localizado PELA PARCELA (é o único caminho que alcança as
 * parcelas 2..N — `orders.asaas_charge_id` só guarda a cobrança que quitou o pedido).
 */
function makeCarne(order: Record<string, unknown>, over: Partial<Record<string, unknown>> = {}) {
  const h = make()
  h.installments.findOrderIdByCharge.mockResolvedValue(String(order.id))
  withQueryResults(h.db, [order])
  h.asaas.getPayment.mockResolvedValue(payment(over))
  return h
}

/** Tabelas passadas a db.update() — prova direta de que matrícula nenhuma foi tocada. */
function updatedTables(db: DrizzleMock): string[] {
  return (db.update.mock.calls as unknown[][]).map((c) =>
    c[0] === enrollments ? 'enrollments' : c[0] === orders ? 'orders' : 'desconhecida'
  )
}

/**
 * Colunas citadas por uma condição de WHERE do drizzle (SQL aninhado — and/or/eq/isNotNull).
 *
 * O mock ignora o WHERE por completo: a fila FIFO responde qualquer consulta. Então a única
 * forma de provar que uma varredura ENXERGA certo pedido é inspecionar a condição construída;
 * um teste de comportamento passaria mesmo com o filtro errado.
 */
function whereColumns(node: unknown, acc: unknown[] = []): unknown[] {
  const chunks = (node as { queryChunks?: unknown[] } | null)?.queryChunks
  if (Array.isArray(chunks)) {
    for (const c of chunks) whereColumns(c, acc)
  } else if (node && typeof node === 'object') {
    acc.push(node)
  }
  return acc
}

/** Último patch passado a .set() que contém a chave pedida. */
function lastPatchWith(db: DrizzleMock, key: string): Record<string, unknown> | undefined {
  return (db.set.mock.calls as unknown[][])
    .map((c) => c[0])
    .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object' && key in v)
    .pop()
}

/** Pagamento no formato novo do getPayment. Sobrescreva só o que o teste precisa. */
function payment(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'pay_1',
    status: 'CONFIRMED',
    value: 10,
    netValue: 9.5,
    externalReference: 'ord_1',
    paymentLink: 'link_1',
    installmentCount: null,
    billingType: 'PIX',
    ...over,
  }
}

const pendingOrder = { id: 'ord_1', tenantId: 't-a', asaasChargeId: null, asaasPaymentLinkId: 'link_1', status: 'pending', totalInCents: 1000 }

describe('WebhookService: a liberação garante o vínculo de aluno do comprador (B3)', () => {
  const comComprador = { ...pendingOrder, userId: 'u-comprador' }

  it('webhook: vínculo no polo do PEDIDO, para quem comprou', async () => {
    const { db, service, asaas, members } = make()
    withQueryResults(db, [comComprador], undefined, undefined)
    asaas.getPayment.mockResolvedValue(payment({ status: 'RECEIVED' }))
    await service.handleEvent('PAYMENT_RECEIVED', { id: 'pay_1', status: 'RECEIVED' })
    expect(members.ensureStudentUnlessPlatform).toHaveBeenCalledWith('t-a', 'u-comprador')
  })

  it('pagamento que o Asaas não confirma não libera nem vincula', async () => {
    const { db, service, asaas, members } = make()
    withQueryResults(db, [comComprador])
    asaas.getPayment.mockResolvedValue(payment({ status: 'PENDING' }))
    await service.handleEvent('PAYMENT_CONFIRMED', { id: 'pay_1', status: 'CONFIRMED' })
    expect(members.ensureStudentUnlessPlatform).not.toHaveBeenCalled()
  })

  it('a varredura de pendentes também vincula (ela projeta o comprador do pedido)', async () => {
    const { db, service, asaas, members } = make()
    withQueryResults(db, [{ id: 'ord_1', tenantId: 't-b', userId: 'u-x', asaasPaymentLinkId: 'link_1', status: 'pending', totalInCents: 1000 }], undefined, undefined, [])
    asaas.listPaymentsByExternalReference.mockResolvedValue([payment()])
    await service.reconcilePending()
    expect(members.ensureStudentUnlessPlatform).toHaveBeenCalledWith('t-b', 'u-x')
    // A projeção da varredura inclui o comprador.
    expect(db.select.mock.calls[0][0]).toHaveProperty('userId')
  })

  it('a baixa manual também vincula', async () => {
    const { db, service, members } = make()
    withQueryResults(db, [{ id: 'ord_9', tenantId: 't-m', userId: 'u-y', status: 'pending', asaasInstallmentId: null }], undefined, undefined)
    await service.settleManually('ord_9')
    expect(members.ensureStudentUnlessPlatform).toHaveBeenCalledWith('t-m', 'u-y')
  })

  it('falha ao vincular não derruba a liberação (o pedido fica pago e o acesso, liberado)', async () => {
    const { db, service, asaas, members, audit } = make()
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    members.ensureStudentUnlessPlatform.mockRejectedValue(new Error('banco caiu'))
    withQueryResults(db, [comComprador], undefined, undefined)
    asaas.getPayment.mockResolvedValue(payment({ status: 'RECEIVED' }))
    await expect(service.handleEvent('PAYMENT_RECEIVED', { id: 'pay_1', status: 'RECEIVED' })).resolves.toBeUndefined()
    expect(updatedTables(db)).toEqual(['orders', 'enrollments'])
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'order.paid' }))
  })
})

describe('WebhookService (order)', () => {
  it('PAYMENT_RECEIVED confirmado pelo Asaas → marca order paga e ativa todas as matrículas dela', async () => {
    const { db, service, asaas } = make()
    withQueryResults(db, [pendingOrder], undefined, undefined)
    asaas.getPayment.mockResolvedValue(payment({ status: 'RECEIVED' }))
    await service.handleEvent('PAYMENT_RECEIVED', { id: 'pay_1', status: 'RECEIVED' })
    expect(asaas.getPayment).toHaveBeenCalledWith('pay_1')
    expect(db.update).toHaveBeenCalled()
  })

  it('order.paid audita com o tenantId do PEDIDO, não de quem aciona (webhook não tem polo de requisição)', async () => {
    const { db, service, asaas, audit } = make()
    withQueryResults(db, [pendingOrder], undefined, undefined)
    asaas.getPayment.mockResolvedValue(payment({ status: 'RECEIVED' }))
    await service.handleEvent('PAYMENT_RECEIVED', { id: 'pay_1', status: 'RECEIVED' })
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-a', action: 'order.paid' }))
  })

  it('cobrança desconhecida → no-op', async () => {
    const { db, service, asaas } = make()
    withQueryResults(db, [], [])
    asaas.getPayment.mockResolvedValue(payment({ externalReference: 'ord_fantasma', paymentLink: 'link_fantasma' }))
    await expect(service.handleEvent('PAYMENT_RECEIVED', { id: 'x', status: 'RECEIVED' })).resolves.toBeUndefined()
    expect(db.update).not.toHaveBeenCalled()
  })

  it('PAYMENT_REFUNDED → cancela order e matrículas', async () => {
    const { db, service, asaas } = make()
    withQueryResults(db, [{ id: 'ord_1', asaasChargeId: 'pay_1', status: 'paid' }], undefined, undefined)
    asaas.getPayment.mockResolvedValue(payment({ status: 'REFUNDED' }))
    await service.handleEvent('PAYMENT_REFUNDED', { id: 'pay_1', status: 'REFUNDED' })
    expect(db.update).toHaveBeenCalled()
  })

  it('PAYMENT_CONFIRMED forjado — Asaas ainda não confirmou → NÃO libera (não confia no payload)', async () => {
    const { db, service, asaas, earnings } = make()
    withQueryResults(db, [pendingOrder])
    asaas.getPayment.mockResolvedValue(payment({ status: 'PENDING', value: null, netValue: null }))
    await service.handleEvent('PAYMENT_CONFIRMED', { id: 'pay_1', status: 'CONFIRMED' })
    expect(asaas.getPayment).toHaveBeenCalledWith('pay_1')
    expect(db.update).not.toHaveBeenCalled()
    expect(earnings.captureForOrder).not.toHaveBeenCalled()
  })

  it('pagamento confirmado que não pertence a pedido nenhum → NÃO libera (âncora é a procedência)', async () => {
    // Substitui o antigo guard de valor, que rejeitava pagamento menor que o total: essa
    // regra tornaria impossível liberar compra parcelada (a parcela é fração do pedido).
    // A defesa contra "forjar pago por R$ 0,01" passou a ser a procedência — o pagamento
    // precisa apontar para um pedido nosso, cujo valor nós definimos ao criar o link.
    const { db, service, asaas, earnings } = make()
    withQueryResults(db, [], [])
    asaas.getPayment.mockResolvedValue(payment({ value: 0.01, netValue: 0.01, externalReference: 'ord_forjada', paymentLink: 'link_forjado' }))
    await service.handleEvent('PAYMENT_CONFIRMED', { id: 'pay_1', status: 'CONFIRMED' })
    expect(db.update).not.toHaveBeenCalled()
    expect(earnings.captureForOrder).not.toHaveBeenCalled()
  })

  it('parcela de pedido parcelado → LIBERA (valor da parcela não cobre o total, e tudo bem)', async () => {
    // Pedido de R$ 5.497,00 em 10x: a parcela vale R$ 549,70. A regra antiga
    // ("valor >= total") rejeitaria toda compra parcelada.
    const { db, service, asaas } = make()
    withQueryResults(db, [{ ...pendingOrder, totalInCents: 549700 }], undefined, undefined)
    asaas.getPayment.mockResolvedValue(payment({ value: 549.7, netValue: 538.2, installmentCount: 10, billingType: 'CREDIT_CARD' }))
    await service.handleEvent('PAYMENT_CONFIRMED', { id: 'pay_1', status: 'CONFIRMED' })
    expect(db.update).toHaveBeenCalled()
  })

  it('localiza o pedido pelo externalReference do pagamento', async () => {
    const { db, service, asaas } = make()
    withQueryResults(db, [pendingOrder], undefined, undefined)
    asaas.getPayment.mockResolvedValue(payment({ paymentLink: null }))
    await service.handleEvent('PAYMENT_CONFIRMED', { id: 'pay_1', status: 'CONFIRMED' })
    expect(db.update).toHaveBeenCalled()
  })

  it('localiza o pedido pelo id do link quando o externalReference não é herdado', async () => {
    // A doc do Asaas não garante que o pagamento herda o externalReference do link.
    // Só UMA query acontece: findOrder pula a busca por id quando externalReference é null.
    const { db, service, asaas } = make()
    withQueryResults(db, [pendingOrder], undefined, undefined)
    asaas.getPayment.mockResolvedValue(payment({ externalReference: null }))
    await service.handleEvent('PAYMENT_CONFIRMED', { id: 'pay_1', status: 'CONFIRMED' })
    expect(db.update).toHaveBeenCalled()
  })

  it('liberação grava o billingType real e o id do pagamento no pedido', async () => {
    const { db, service, asaas } = make()
    withQueryResults(db, [{ ...pendingOrder, totalInCents: 549700 }], undefined, undefined)
    asaas.getPayment.mockResolvedValue(payment({ value: 549.7, netValue: 538.2, installmentCount: 10, billingType: 'CREDIT_CARD' }))
    await service.handleEvent('PAYMENT_CONFIRMED', { id: 'pay_1', status: 'CONFIRMED' })
    const patch = (db.set.mock.calls as unknown[][])
      .map((c) => c[0])
      .find((v): v is Record<string, unknown> => !!v && typeof v === 'object' && 'billingType' in v)
    expect(patch?.billingType).toBe('CREDIT_CARD')
    expect(patch?.asaasChargeId).toBe('pay_1')
  })

  it('liberação grava quantas parcelas o aluno escolheu', async () => {
    const { db, service, asaas } = make()
    withQueryResults(db, [{ ...pendingOrder, totalInCents: 549700 }], undefined, undefined)
    asaas.getPayment.mockResolvedValue(payment({ value: 549.7, netValue: 538.2, installmentCount: 10, billingType: 'CREDIT_CARD' }))
    await service.handleEvent('PAYMENT_CONFIRMED', { id: 'pay_1', status: 'CONFIRMED' })
    const patch = (db.set.mock.calls as unknown[][])
      .map((c) => c[0])
      .find((v): v is Record<string, unknown> => !!v && typeof v === 'object' && 'installmentCount' in v)
    expect(patch?.installmentCount).toBe(10)
  })

  it('pagamento à vista → installmentCount nulo, sem inventar 1x', async () => {
    const { db, service, asaas } = make()
    withQueryResults(db, [{ ...pendingOrder, totalInCents: 50000 }], undefined, undefined)
    asaas.getPayment.mockResolvedValue(payment({ status: 'RECEIVED', value: 500, netValue: 489.76, installmentCount: null, billingType: 'PIX' }))
    await service.handleEvent('PAYMENT_RECEIVED', { id: 'pay_1', status: 'RECEIVED' })
    const patch = (db.set.mock.calls as unknown[][])
      .map((c) => c[0])
      .find((v): v is Record<string, unknown> => !!v && typeof v === 'object' && 'billingType' in v)
    expect(patch?.installmentCount).toBeNull()
  })

  it('PAYMENT_CONFIRMED reenviado após refund (pedido canceled) → NÃO reativa nada (anti-replay)', async () => {
    // O guarda antigo era `status !== 'pending'`, que também servia de anti-replay. Agora o
    // anti-replay é explícito (`canceled`) e precisa barrar TAMBÉM o caminho novo das parcelas:
    // um pedido cancelado não pode ter parcela marcada, ganho capturado nem acesso religado.
    const { db, service, earnings, installments } = makeCarne(
      { ...pendingOrder, status: 'canceled', asaasInstallmentId: 'inst_1', installmentCount: 5 }
    )
    await service.handleEvent('PAYMENT_CONFIRMED', { id: 'pay_1', status: 'CONFIRMED' })
    expect(db.update).not.toHaveBeenCalled()
    expect(installments.markStatus).not.toHaveBeenCalled()
    expect(earnings.captureForOrder).not.toHaveBeenCalled()
    expect(earnings.captureForInstallment).not.toHaveBeenCalled()
  })

  it('PAYMENT_CONFIRMED em carnê já pago → registra a parcela, mas NÃO libera acesso de novo', async () => {
    // A propriedade antiga ("pedido pago é no-op") vale só para a LIBERAÇÃO. Da 2a parcela em
    // diante o pedido está sempre `paid`: se o fluxo inteiro parasse aqui, nenhuma parcela além
    // da primeira seria registrada e o carnê nunca quitaria.
    const { db, service, audit, earnings, installments } = makeCarne(
      { ...pendingOrder, status: 'paid', asaasInstallmentId: 'inst_1', installmentCount: 5 },
      { id: 'pay_2' }
    )
    await service.handleEvent('PAYMENT_CONFIRMED', { id: 'pay_2', status: 'CONFIRMED' })
    expect(installments.markStatus).toHaveBeenCalledWith('pay_2', 'paid', expect.anything())
    // acesso não é religado: nem pedido, nem matrícula, nem auditoria de liberação
    expect(db.update).not.toHaveBeenCalled()
    expect(audit.log).not.toHaveBeenCalled()
    // dinheiro só no RECEIVED
    expect(earnings.captureForInstallment).not.toHaveBeenCalled()
  })

  it('1a parcela do carnê libera o acesso sem quitar e sem mexer no nº de parcelas', async () => {
    // O pagamento de um carnê traz `installmentNumber`, não necessariamente `installmentCount`:
    // sobrescrever a coluna com null apagaria o total contratado (gravado no checkout) e
    // settleIfComplete desistiria para sempre — o carnê nunca quitaria.
    const { db, service, earnings, installments } = makeCarne(
      { ...pendingOrder, status: 'pending', asaasInstallmentId: 'inst_1', installmentCount: 5 },
      { status: 'RECEIVED', installmentCount: null }
    )
    await service.handleEvent('PAYMENT_RECEIVED', { id: 'pay_1', status: 'RECEIVED' })
    const patch = lastPatchWith(db, 'paidAt')
    expect(patch?.status).toBe('paid')
    expect(patch).not.toHaveProperty('installmentCount')
    expect(patch).not.toHaveProperty('settledAt')
    // matrícula ativada (o aluno estuda desde a 1a parcela)
    expect(updatedTables(db)).toContain('enrollments')
    expect(earnings.captureForOrder).not.toHaveBeenCalled()
    expect(installments.isSettled).toHaveBeenCalledWith('ord_1', 5)
  })

  it('a 2a parcela é registrada e capturada mesmo com o pedido já pago', async () => {
    const { service, earnings, installments } = makeCarne(
      { ...pendingOrder, status: 'paid', asaasInstallmentId: 'inst_1', installmentCount: 5 },
      { id: 'pay_2', status: 'RECEIVED' }
    )
    await service.handleEvent('PAYMENT_RECEIVED', { id: 'pay_2', status: 'RECEIVED' })
    expect(installments.markStatus).toHaveBeenCalledWith('pay_2', 'paid', expect.anything())
    // valor da parcela (R$ 10,00) e taxa REAL daquele boleto (R$ 0,50), em centavos
    expect(earnings.captureForInstallment).toHaveBeenCalledWith('ord_1', 'pay_2', 1000, 50)
    // e o ganho do PEDIDO INTEIRO nunca é capturado num carnê (creditaria até 200%)
    expect(earnings.captureForOrder).not.toHaveBeenCalled()
  })

  it('não processa parcela de pedido CANCELADO (anti-replay no PAYMENT_RECEIVED)', async () => {
    const { service, earnings, installments } = makeCarne(
      { ...pendingOrder, status: 'canceled', asaasInstallmentId: 'inst_1', installmentCount: 5 },
      { id: 'pay_2', status: 'RECEIVED' }
    )
    await service.handleEvent('PAYMENT_RECEIVED', { id: 'pay_2', status: 'RECEIVED' })
    expect(installments.markStatus).not.toHaveBeenCalled()
    expect(earnings.captureForInstallment).not.toHaveBeenCalled()
  })

  it('PAYMENT_CONFIRMED de carnê que o Asaas NÃO confirma → não marca parcela nem captura', async () => {
    // O token do webhook é gatilho, não autorização: o status vem do getPayment, nunca do payload.
    const { service, earnings, installments } = makeCarne(
      { ...pendingOrder, status: 'paid', asaasInstallmentId: 'inst_1', installmentCount: 5 },
      { id: 'pay_2', status: 'PENDING', value: null, netValue: null }
    )
    await service.handleEvent('PAYMENT_RECEIVED', { id: 'pay_2', status: 'RECEIVED' })
    expect(installments.markStatus).not.toHaveBeenCalled()
    expect(earnings.captureForInstallment).not.toHaveBeenCalled()
  })

  it('PAYMENT_OVERDUE localiza o pedido pela parcela e marca overdue, sem tocar matrícula', async () => {
    // Buscando por orders.asaas_charge_id (como antes), num carnê isto NUNCA casaria e o evento
    // morreria em "cobrança desconhecida".
    const { db, service, installments } = makeCarne(
      { ...pendingOrder, status: 'paid', asaasInstallmentId: 'inst_1', installmentCount: 5 },
      { id: 'pay_3', status: 'OVERDUE' }
    )
    await service.handleEvent('PAYMENT_OVERDUE', { id: 'pay_3', status: 'OVERDUE' })
    expect(installments.markStatus).toHaveBeenCalledWith('pay_3', 'overdue', undefined)
    // decisão do dono: inadimplência NÃO tira o acesso ao conteúdo
    expect(updatedTables(db)).not.toContain('enrollments')
  })

  it('estorno de UMA parcela não cancela o pedido nem as matrículas', async () => {
    const { db, service, installments } = makeCarne(
      { ...pendingOrder, status: 'paid', asaasInstallmentId: 'inst_1', installmentCount: 5 },
      { id: 'pay_1', status: 'REFUNDED' }
    )
    await service.handleEvent('PAYMENT_REFUNDED', { id: 'pay_1', status: 'REFUNDED' })
    expect(installments.markStatus).toHaveBeenCalledWith('pay_1', 'refunded', undefined)
    expect(updatedTables(db)).not.toContain('enrollments')
    // o pedido deixa de estar quitado, mas continua `paid` (o aluno pagou 4 de 5)
    expect(lastPatchWith(db, 'settledAt')?.settledAt).toBeNull()
    expect(lastPatchWith(db, 'status')).toBeUndefined()
  })

  it('estorno que zera as parcelas pagas do carnê vira WARN acionável (curso inteiro de graça)', async () => {
    // Aluno compra carnê 5x de R$ 1.000, paga a parcela 1 (R$ 200) → acesso liberado, e pede
    // estorno dela. Não deve mais nada e nunca mais vai pagar: é o cancelamento à vista com
    // outro nome. Não revogamos automaticamente (regra do dono), mas o caso não pode ficar
    // invisível atrás de um `logger.log` dizendo "acesso preservado".
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      const { db, service, installments } = makeCarne(
        { ...pendingOrder, status: 'paid', asaasInstallmentId: 'inst_1', installmentCount: 5 },
        { id: 'pay_1', status: 'REFUNDED' }
      )
      installments.paidChargeIds.mockResolvedValue(new Set())
      await service.handleEvent('PAYMENT_REFUNDED', { id: 'pay_1', status: 'REFUNDED' })
      const msgs = warn.mock.calls.map((c) => String(c[0])).join(' | ')
      expect(msgs).toContain('SEM NENHUMA parcela paga')
      expect(msgs).toContain('ord_1')
      // segue sendo só um aviso: matrícula nenhuma é revogada
      expect(updatedTables(db)).not.toContain('enrollments')
      // A ORDEM é a regra, não um detalhe: `paidChargeIds` filtra status='paid', então
      // consultar ANTES de marcar a parcela como estornada ainda a contaria como paga e
      // o WARN nunca sairia. Sem esta assertiva, inverter as duas chamadas no código
      // deixaria este teste verde (o mock devolve o mesmo conjunto nas duas ordens).
      expect(installments.markStatus.mock.invocationCallOrder[0]).toBeLessThan(
        installments.paidChargeIds.mock.invocationCallOrder[0]
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('estorno de UMA parcela com outras ainda pagas NÃO gera o WARN (isso é inadimplência normal)', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      const { service, installments } = makeCarne(
        { ...pendingOrder, status: 'paid', asaasInstallmentId: 'inst_1', installmentCount: 5 },
        { id: 'pay_4', status: 'REFUNDED' }
      )
      installments.paidChargeIds.mockResolvedValue(new Set(['pay_1', 'pay_2', 'pay_3']))
      await service.handleEvent('PAYMENT_REFUNDED', { id: 'pay_4', status: 'REFUNDED' })
      expect(warn.mock.calls.map((c) => String(c[0])).join(' | ')).not.toContain('SEM NENHUMA parcela paga')
    } finally {
      warn.mockRestore()
    }
  })

  it('estorno de pedido à vista continua cancelando tudo', async () => {
    const { db, service, asaas } = make()
    withQueryResults(db, [{ ...pendingOrder, id: 'ord_2', status: 'paid', asaasChargeId: 'pay_x', asaasInstallmentId: null }])
    asaas.getPayment.mockResolvedValue(payment({ id: 'pay_x', status: 'REFUNDED', externalReference: 'ord_2' }))
    await service.handleEvent('PAYMENT_REFUNDED', { id: 'pay_x', status: 'REFUNDED' })
    expect(updatedTables(db)).toContain('enrollments')
  })

  it('estorno de cobrança IRMÃ (não foi a que pagou) NÃO cancela as matrículas', async () => {
    // Um segundo clique no link de pagamento cria outra cobrança, nunca paga. Ela aponta para o
    // mesmo pedido pelo externalReference, então desde que findOrder foi alargado ela ALCANÇA o
    // ramo de estorno — e cancelaria as matrículas de um aluno que pagou. O gate de "não rebaixar
    // o que está pago" não pega: a irmã abandonada vem PENDING/OVERDUE.
    const { db, service, asaas } = make()
    withQueryResults(db, [{ ...pendingOrder, id: 'ord_2', status: 'paid', asaasChargeId: 'pay_1', asaasInstallmentId: null }])
    asaas.getPayment.mockResolvedValue(payment({ id: 'pay_2', status: 'PENDING', externalReference: 'ord_2' }))
    await service.handleEvent('PAYMENT_REFUNDED', { id: 'pay_2', status: 'REFUNDED' })
    expect(db.update).not.toHaveBeenCalled()
    expect(updatedTables(db)).not.toContain('enrollments')
  })

  it('parcela inexistente em order_installments vira WARN (senão o carnê não quita em silêncio)', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      const { service, installments } = makeCarne(
        { ...pendingOrder, status: 'paid', asaasInstallmentId: 'inst_1', installmentCount: 5 },
        { id: 'pay_2', status: 'RECEIVED' }
      )
      installments.markStatus.mockResolvedValue(false)
      await service.handleEvent('PAYMENT_RECEIVED', { id: 'pay_2', status: 'RECEIVED' })
      expect(warn.mock.calls.map((c) => String(c[0])).join(' | ')).toContain('não tem parcela em order_installments')
    } finally {
      warn.mockRestore()
    }
  })

  it('settled_at só é carimbado quando a última parcela do carnê é paga', async () => {
    const carneOrder = { ...pendingOrder, status: 'paid', asaasInstallmentId: 'inst_1', installmentCount: 5 }
    const { db, service, installments } = makeCarne(carneOrder, { id: 'pay_3', status: 'RECEIVED' })
    await service.handleEvent('PAYMENT_RECEIVED', { id: 'pay_3', status: 'RECEIVED' })
    expect(installments.isSettled).toHaveBeenCalledWith('ord_1', 5)
    expect(lastPatchWith(db, 'settledAt')).toBeUndefined()

    db.set.mockClear()
    db.update.mockClear()
    withQueryResults(db, [carneOrder])
    installments.isSettled.mockResolvedValue(true)
    await service.handleEvent('PAYMENT_RECEIVED', { id: 'pay_5', status: 'RECEIVED' })
    expect(lastPatchWith(db, 'settledAt')?.settledAt).toBeInstanceOf(Date)
  })

  it('pedido à vista carimba settled_at junto do paid_at', async () => {
    const { db, service, asaas } = make()
    withQueryResults(db, [pendingOrder], undefined, undefined)
    asaas.getPayment.mockResolvedValue(payment({ status: 'RECEIVED' }))
    await service.handleEvent('PAYMENT_RECEIVED', { id: 'pay_1', status: 'RECEIVED' })
    expect(lastPatchWith(db, 'paidAt')?.settledAt).toBeInstanceOf(Date)
  })

  it('reconcilePending varre pedidos pendentes com link e libera os já pagos', async () => {
    const { db, service, asaas, audit } = make()
    withQueryResults(
      db,
      [{ id: 'ord_1', tenantId: 't-b', asaasPaymentLinkId: 'link_1', status: 'pending', totalInCents: 549700 }],
      undefined, // UPDATE orders
      undefined, // UPDATE enrollments
      [] // varredura de carnês: nenhum pedido paid/aberto
    )
    asaas.listPaymentsByExternalReference.mockResolvedValue([
      payment({ value: 549.7, netValue: 538.2, installmentCount: 10, billingType: 'CREDIT_CARD' }),
    ])
    const r = await service.reconcilePending()
    expect(asaas.listPaymentsByExternalReference).toHaveBeenCalledWith('ord_1')
    expect(r).toEqual({ checked: 1, reconciled: 1, stillPending: 0, failed: 0, installmentsReconciled: 0, settled: 0 })
    // tenantId do pedido (projetado em fetchPendingWithLinkOrCarne), não um valor fixo —
    // a reconciliação PULL precisa preservar o polo tanto quanto o webhook PUSH preserva.
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-b', action: 'order.paid' }))
  })

  it('reconcilePending mantém pendente quando o link ainda não tem pagamento pago', async () => {
    const { db, service, asaas } = make()
    withQueryResults(db, [{ id: 'ord_1', asaasPaymentLinkId: 'link_1', status: 'pending', totalInCents: 549700 }], [])
    asaas.listPaymentsByExternalReference.mockResolvedValue([payment({ status: 'PENDING', value: 549.7, netValue: null })])
    const r = await service.reconcilePending()
    expect(r).toEqual({ checked: 1, reconciled: 0, stillPending: 1, failed: 0, installmentsReconciled: 0, settled: 0 })
  })

  it('reconcilePending com link sem pagamento nenhum → segue pendente, sem erro', async () => {
    const { db, service, asaas } = make()
    // segunda leva enfileirada = a varredura de carnês (nenhum pedido paid/carnê aberto aqui)
    withQueryResults(db, [{ id: 'ord_1', asaasPaymentLinkId: 'link_1', status: 'pending', totalInCents: 549700 }], [])
    asaas.listPaymentsByExternalReference.mockResolvedValue([])
    const r = await service.reconcilePending()
    expect(r).toEqual({ checked: 1, reconciled: 0, stillPending: 1, failed: 0, installmentsReconciled: 0, settled: 0 })
  })

  it('reconcilePending pagina além da primeira leva de pendentes, sem limite fixo travar o restante', async () => {
    // A varredura antiga era um `.limit(200)` fixo: um carnê em curso por meses lotaria essa
    // leva e faria os pedidos `pending` mais antigos nunca serem revistos. Prova que a segunda
    // página é de fato buscada e processada.
    const { db, service, asaas } = make()
    const fullPage = Array.from({ length: RECONCILE_PAGE_SIZE }, (_, i) => ({
      id: `ord_p${i}`,
      asaasPaymentLinkId: `link_p${i}`,
      status: 'pending',
      totalInCents: 1000,
      asaasInstallmentId: null,
    }))
    const secondPage = [
      { id: 'ord_last', asaasPaymentLinkId: 'link_last', status: 'pending', totalInCents: 1000, asaasInstallmentId: null },
    ]
    withQueryResults(db, fullPage, secondPage, [] /* varredura de carnês: nada */)
    asaas.listPaymentsByExternalReference.mockResolvedValue([])
    const r = await service.reconcilePending()
    expect(asaas.listPaymentsByExternalReference).toHaveBeenCalledWith('ord_last')
    expect(r.checked).toBe(RECONCILE_PAGE_SIZE + 1)
    // ordem estável entre páginas — sem ORDER BY, uma escrita concorrente pode pular uma linha
    expect(db.orderBy).toHaveBeenCalledWith(orders.id)
  })

  it('reconcilePending alcança pedidos pagos com carnê em aberto', async () => {
    // O laço antigo varria só `pending`. Um carnê sai de pending na 1a parcela e nunca mais
    // seria varrido — o furo cai exatamente neste caso: pedido `paid`, ainda não quitado.
    const { db, service, asaas } = make()
    withQueryResults(db, [] /* nenhum pending */, [{ id: 'ord_1', asaasInstallmentId: 'inst_1', installmentCount: 5 }])
    asaas.listInstallmentPayments.mockResolvedValue([])
    const out = await service.reconcilePending()
    expect(asaas.listInstallmentPayments).toHaveBeenCalledWith('inst_1')
    expect(out.checked).toBe(1)
    // a busca de carnês também pagina com ordem estável (mesma razão da de pendentes)
    expect(db.orderBy).toHaveBeenCalledWith(orders.id)
  })

  it('reconcilePending não para na primeira parcela paga de um carnê', async () => {
    // O `break` do laço antigo processaria só uma cobrança por pedido — um carnê pode ter
    // várias parcelas para conciliar de uma vez (é exatamente o gap que este sweep fecha).
    const { db, service, asaas, installments, earnings } = make()
    withQueryResults(db, [], [{ id: 'ord_1', asaasInstallmentId: 'inst_1', installmentCount: 5 }])
    asaas.listInstallmentPayments.mockResolvedValue([
      payment({ id: 'pay_1', status: 'RECEIVED' }),
      payment({ id: 'pay_2', status: 'RECEIVED' }),
      payment({ id: 'pay_3', status: 'RECEIVED' }),
    ])
    const out = await service.reconcilePending()
    expect(installments.markStatus).toHaveBeenCalledTimes(3)
    expect(earnings.captureForInstallment).toHaveBeenCalledTimes(3)
    expect(out.installmentsReconciled).toBe(3)
    // settleIfComplete é chamado uma vez por PEDIDO, depois de tratar todas as parcelas dele
    expect(installments.isSettled).toHaveBeenCalledTimes(1)
    expect(installments.isSettled).toHaveBeenCalledWith('ord_1', 5)
  })

  it('não reprocessa parcela já marcada paga em rodada anterior (não reescreve paidAt com a data de hoje)', async () => {
    // O carnê fica nesta varredura por MESES, até a última parcela cair. Sem este filtro, toda
    // rodada diária remarcaria a mesma parcela paga há meses, sobrescrevendo paidAt com "hoje".
    const { db, service, asaas, installments, earnings } = make()
    withQueryResults(db, [], [{ id: 'ord_1', asaasInstallmentId: 'inst_1', installmentCount: 5 }])
    asaas.listInstallmentPayments.mockResolvedValue([payment({ id: 'pay_1', status: 'RECEIVED' })])
    installments.paidChargeIds.mockResolvedValue(new Set(['pay_1']))
    const out = await service.reconcilePending()
    expect(installments.markStatus).not.toHaveBeenCalled()
    expect(earnings.captureForInstallment).not.toHaveBeenCalled()
    expect(out.installmentsReconciled).toBe(0)
  })

  it('reconcilePending ignora parcela que o Asaas ainda não confirma como paga', async () => {
    // Nunca confiar em status intermediário: só o que bate com PAID_STATUSES é gravado.
    const { db, service, asaas, installments } = make()
    withQueryResults(db, [], [{ id: 'ord_1', asaasInstallmentId: 'inst_1', installmentCount: 5 }])
    asaas.listInstallmentPayments.mockResolvedValue([payment({ id: 'pay_2', status: 'PENDING', value: null, netValue: null })])
    const out = await service.reconcilePending()
    expect(installments.markStatus).not.toHaveBeenCalled()
    expect(out.installmentsReconciled).toBe(0)
  })

  it('reconcilePending quita o carnê (settled_at) quando a última parcela reconciliada fecha a conta', async () => {
    const { db, service, asaas, installments } = make()
    withQueryResults(
      db,
      [],
      [{ id: 'ord_1', asaasInstallmentId: 'inst_1', installmentCount: 5 }],
      undefined // UPDATE orders (settled_at) dentro de settleIfComplete
    )
    asaas.listInstallmentPayments.mockResolvedValue([payment({ id: 'pay_5', status: 'RECEIVED' })])
    installments.isSettled.mockResolvedValue(true)
    const out = await service.reconcilePending()
    expect(lastPatchWith(db, 'settledAt')?.settledAt).toBeInstanceOf(Date)
    expect(out.settled).toBe(1)
  })

  it('falha ao reconciliar um carnê não aborta os demais pedidos da rodada (try/catch por pedido)', async () => {
    const { db, service, asaas, earnings, installments } = make()
    withQueryResults(db, [], [
      { id: 'ord_1', asaasInstallmentId: 'inst_1', installmentCount: 5 },
      { id: 'ord_2', asaasInstallmentId: 'inst_2', installmentCount: 5 },
    ])
    // O mock por padrão não recebe argumento (ver `make()`); só ESTE teste precisa diferenciar
    // por id, daí o cast local em vez de mudar a assinatura compartilhada por todos os outros.
    ;(asaas.listInstallmentPayments as unknown as jest.Mock<Promise<Record<string, unknown>[]>, [string]>).mockImplementation(
      async (id) => (id === 'inst_1' ? [payment({ id: 'pay_1', status: 'RECEIVED' })] : [payment({ id: 'pay_2', status: 'RECEIVED' })])
    )
    earnings.captureForInstallment.mockRejectedValueOnce(new Error('boom'))
    const out = await service.reconcilePending()
    // ord_1 falha na CAPTURA (antes de marcar — ver ordem em reconcileCarneSweep), então sua
    // parcela nunca é marcada; ord_2 não é abortado pela falha do 1º e segue até marcar a dele.
    expect(installments.markStatus).toHaveBeenCalledTimes(1)
    expect(installments.markStatus).toHaveBeenCalledWith('pay_2', 'paid', expect.anything())
    expect(out.checked).toBe(2)
    expect(out.failed).toBe(1)
  })

  it('captura de ganho que falha NÃO marca a parcela paga — ela é retentada na próxima rodada, nunca fica presa', async () => {
    // Regressão que o filtro paidChargeIds introduziria se a ordem fosse "marca, depois
    // captura": uma falha na captura deixaria a parcela `paid` localmente SEM o ganho nunca
    // capturado, e como ela já não apareceria mais como pendente em paidChargeIds, nenhuma
    // rodada futura a revisitaria — o instrutor ficaria sub-pago pra sempre, em silêncio.
    const { db, service, asaas, installments, earnings } = make()
    const carneOrder = { id: 'ord_1', asaasInstallmentId: 'inst_1', installmentCount: 5 }
    const parcela = payment({ id: 'pay_1', status: 'RECEIVED' })

    // rodada 1 (hoje): a captura falha (deadlock, blip de rede — qualquer coisa)
    withQueryResults(db, [], [carneOrder])
    asaas.listInstallmentPayments.mockResolvedValue([parcela])
    earnings.captureForInstallment.mockRejectedValueOnce(new Error('deadlock'))
    const out1 = await service.reconcilePending()
    expect(installments.markStatus).not.toHaveBeenCalled()
    expect(out1.failed).toBe(1)
    expect(out1.installmentsReconciled).toBe(0)

    // rodada 2 (o cron de amanhã): como a parcela nunca foi marcada, paidChargeIds (mock
    // segue vazio por padrão) não a filtra — ela é retentada, e desta vez tudo funciona.
    withQueryResults(db, [], [carneOrder])
    const out2 = await service.reconcilePending()
    expect(installments.markStatus).toHaveBeenCalledWith('pay_1', 'paid', expect.anything())
    expect(earnings.captureForInstallment).toHaveBeenCalledTimes(2)
    expect(out2.installmentsReconciled).toBe(1)
  })

  it('carnê sem linhas locais (checkout tolerou falhar a listagem): recordFromPayments cria as linhas e o carnê consegue quitar', async () => {
    // checkout.service.ts tolera a listagem de parcelas falhar na criação, prometendo que "a
    // reconciliação recupera depois". markStatus só faz UPDATE — sem recordFromPayments aqui,
    // esse pedido nunca teria linha em order_installments e o certificado ficaria PRESO DE
    // VERDADE (não só atrasado um dia): isSettled jamais bateria com installmentCount.
    const { db, service, asaas, installments } = make()
    withQueryResults(
      db,
      [],
      [{ id: 'ord_1', asaasInstallmentId: 'inst_1', installmentCount: 2 }],
      undefined // UPDATE orders (settled_at) dentro de settleIfComplete
    )
    const parcelas = [payment({ id: 'pay_1', status: 'RECEIVED' }), payment({ id: 'pay_2', status: 'RECEIVED' })]
    asaas.listInstallmentPayments.mockResolvedValue(parcelas)
    installments.isSettled.mockResolvedValue(true)
    const out = await service.reconcilePending()
    expect(installments.recordFromPayments).toHaveBeenCalledWith('ord_1', parcelas)
    expect(installments.markStatus).toHaveBeenCalledTimes(2)
    expect(out.settled).toBe(1)
  })

  it('um carnê liberado pela varredura de pendentes é conciliado NA MESMA rodada (a varredura de carnês roda depois, não antes)', async () => {
    // Prova de ponta a ponta o motivo de fetchOpenCarnes() ter que rodar DEPOIS de
    // reconcilePendingSweep: um pedido de carnê ainda `pending` é liberado pela 1a varredura
    // (parcela 1 paga) e, na MESMA chamada de reconcilePending, já aparece na varredura de
    // carnês (paid + settled_at null) — sem esperar o cron de amanhã.
    const { db, service, asaas, earnings, installments } = make()
    // Estado que o checkout REALMENTE produz num carnê: link nulo (só o ramo à vista/cartão
    // grava `asaasPaymentLinkId`), âncora no `asaasInstallmentId`. O fixture antigo tinha os
    // dois preenchidos — combinação impossível, que o banco mockado deixava passar.
    const carneOrder = { id: 'ord_1', asaasPaymentLinkId: null, status: 'pending', totalInCents: 1000, asaasInstallmentId: 'inst_1' }
    withQueryResults(
      db,
      [carneOrder], // 1a leva: varredura de pendentes
      undefined, // UPDATE orders (releaseIfPaid → applyPaid)
      undefined, // UPDATE enrollments
      [{ id: 'ord_1', asaasInstallmentId: 'inst_1', installmentCount: 5 }] // 2a leva: varredura de carnês, MESMA rodada
    )
    asaas.listPaymentsByExternalReference.mockResolvedValue([payment({ id: 'pay_1', status: 'RECEIVED' })])
    asaas.listInstallmentPayments.mockResolvedValue([payment({ id: 'pay_1', status: 'RECEIVED' })])
    await service.reconcilePending()

    // comportamento fim a fim: a parcela 1, liberada agora mesmo, já é conciliada nesta rodada
    expect(installments.markStatus).toHaveBeenCalledWith('pay_1', 'paid', expect.anything())
    // acesso liberado (matrículas ativadas), sem carimbar settled_at: faltam 4 parcelas
    expect(updatedTables(db)).toContain('enrollments')
    expect(lastPatchWith(db, 'paidAt')).not.toHaveProperty('settledAt')
    // ganho DAQUELA parcela (R$ 10,00, taxa de R$ 0,50), nunca o do pedido inteiro
    expect(earnings.captureForInstallment).toHaveBeenCalledWith('ord_1', 'pay_1', 1000, 50)
    expect(earnings.captureForOrder).not.toHaveBeenCalled()

    // a invariante de ORDEM que sustenta o comportamento acima: a 2a busca (carnês) só
    // acontece depois que os UPDATEs da liberação (1a busca) já rodaram. Um refactor que
    // buscasse as duas listas antes de varrer (ou as paralelizasse com Promise.all) quebra
    // esta asserção — não o certificado de um aluno.
    const secondSelectOrder = db.select.mock.invocationCallOrder[1]
    const lastUpdateOrder = Math.max(...db.update.mock.invocationCallOrder)
    expect(secondSelectOrder).toBeGreaterThan(lastUpdateOrder)
  })

  it('a varredura de pendentes procura carnê SEM link de pagamento (o checkout deixa o link nulo)', async () => {
    // O furo que este teste fecha: `asaasPaymentLinkId IS NOT NULL` sozinho tornava todo carnê
    // `pending` invisível às DUAS varreduras (a de carnês exige `paid`). Aluno paga o boleto 1,
    // o webhook se perde, o pedido fica `pending` para sempre — pagou e não tem acesso.
    const { db, service } = make()
    withQueryResults(db, [], [])
    await service.reconcilePending()
    const cols = whereColumns(db.where.mock.calls[0][0])
    expect(cols).toContain(orders.asaasInstallmentId)
    expect(cols).toContain(orders.asaasPaymentLinkId)
    // As duas colunas presentes NÃO bastam: com `and` no lugar de `or` o bug volta
    // inteiro (carnê tem installmentId e link nulo, então nunca satisfaria as duas).
    // Por isso o teste olha o SQL renderizado, e não só quais colunas aparecem.
    const { sql: text } = new MySqlDialect().sqlToQuery(db.where.mock.calls[0][0] as SQL)
    expect(text).toMatch(/is not null\s+or\s+/i)
  })

  it('settleManually → marca pedido pending como pago e quitado', async () => {
    const { db, service } = make()
    withQueryResults(db, [{ id: 'ord_9', status: 'pending', asaasInstallmentId: null }], undefined, undefined)
    const r = await service.settleManually('ord_9')
    expect(r).toEqual({ alreadyPaid: false })
    expect(db.update).toHaveBeenCalled()
    // Num pedido à vista não há parcela por vir: se a baixa manual não carimbasse settled_at,
    // o pedido ficaria pago e eternamente "não quitado" nos relatórios. (Num carnê é o
    // contrário — ver o teste logo abaixo.)
    expect(lastPatchWith(db, 'paidAt')?.settledAt).toBeInstanceOf(Date)
  })

  it('settleManually de carnê NÃO captura o ganho do pedido inteiro', async () => {
    // As parcelas já pagas geraram ganho uma a uma; somar o pedido inteiro por cima
    // creditaria o instrutor duas vezes.
    const { db, service, earnings } = make()
    withQueryResults(db, [{ id: 'ord_9', status: 'pending', asaasInstallmentId: 'inst_1' }], undefined, undefined)
    await service.settleManually('ord_9')
    expect(earnings.captureForOrder).not.toHaveBeenCalled()
  })

  it('settleManually de carnê pendente libera o acesso mas NÃO quita (certificado continua preso)', async () => {
    // Carimbar settled_at aqui destravaria o certificado com 4 de 5 parcelas em aberto e ainda
    // tiraria o pedido de fetchOpenCarnes (que exige settled_at IS NULL): nenhuma parcela
    // futura seria reconciliada. Quitar um carnê é settleCarneManually, operação à parte.
    const { db, service } = make()
    withQueryResults(db, [{ id: 'ord_9', status: 'pending', asaasInstallmentId: 'inst_1' }], undefined, undefined)
    await service.settleManually('ord_9')
    const patch = lastPatchWith(db, 'paidAt')
    expect(patch?.status).toBe('paid')
    expect(patch).not.toHaveProperty('settledAt')
    // o acesso sai na hora — é para isso que a baixa manual existe
    expect(updatedTables(db)).toContain('enrollments')
  })

  it('evento sem ação (PAYMENT_CREATED) nem consulta o Asaas', async () => {
    // O Asaas dispara dezenas de eventos por cobrança; consultar a API para ignorá-los
    // custaria uma chamada externa (e um 500 com retry quando ela falhasse) por evento.
    const { db, service, asaas } = make()
    await service.handleEvent('PAYMENT_CREATED', { id: 'pay_1', status: 'PENDING' })
    expect(asaas.getPayment).not.toHaveBeenCalled()
    expect(db.update).not.toHaveBeenCalled()
  })

  it('settleManually → pedido já pago é no-op', async () => {
    const { db, service } = make()
    withQueryResults(db, [{ id: 'ord_9', status: 'paid' }])
    const r = await service.settleManually('ord_9')
    expect(r).toEqual({ alreadyPaid: true })
    expect(db.update).not.toHaveBeenCalled()
  })

  it('settleManually → pedido inexistente lança NotFound', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    await expect(service.settleManually('nope')).rejects.toThrow()
  })

  it('cancelManually → cancela pedido pending', async () => {
    const { db, service } = make()
    withQueryResults(db, [{ id: 'ord_9', status: 'pending' }], undefined, undefined)
    const r = await service.cancelManually('ord_9')
    expect(r).toEqual({ alreadyCanceled: false })
    expect(db.update).toHaveBeenCalled()
  })

  it('settleCarneManually → carimba settled_at de um carnê paid com parcelas em aberto', async () => {
    // É exatamente o estado que settleManually recusa (status já é `paid`) e que a UI antiga
    // não sabia operar: 3 de 5 parcelas pagas, acesso liberado, certificado ainda preso.
    const { db, service } = make()
    withQueryResults(db, [{ id: 'ord_9', status: 'paid', settledAt: null }], undefined)
    const r = await service.settleCarneManually('ord_9')
    expect(r).toEqual({ alreadySettled: false })
    expect(lastPatchWith(db, 'settledAt')?.settledAt).toBeInstanceOf(Date)
  })

  it('settleCarneManually → idempotente: pedido já quitado não é regravado', async () => {
    const { db, service } = make()
    withQueryResults(db, [{ id: 'ord_9', status: 'paid', settledAt: new Date('2026-01-01') }])
    const r = await service.settleCarneManually('ord_9')
    expect(r).toEqual({ alreadySettled: true })
    expect(db.update).not.toHaveBeenCalled()
  })

  it('settleCarneManually → pedido inexistente lança NotFound', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    await expect(service.settleCarneManually('nope')).rejects.toThrow()
  })

  it('settleCarneManually → rejeita pedido que ainda não está pago', async () => {
    const { db, service } = make()
    withQueryResults(db, [{ id: 'ord_9', status: 'pending', settledAt: null }])
    await expect(service.settleCarneManually('ord_9')).rejects.toThrow()
    expect(db.update).not.toHaveBeenCalled()
  })
})
