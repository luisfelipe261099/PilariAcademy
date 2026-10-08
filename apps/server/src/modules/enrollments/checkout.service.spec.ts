/// <reference types="jest" />
import { BadRequestException, ConflictException } from '@nestjs/common'
import { createDrizzleMock, withQueryResults, type DrizzleMock } from '../../__test-utils__/drizzle-mock'
import { allWheres } from '../../__test-utils__/sql'
import { couponRedemptions } from '../../db/schema'
import type { AsaasPayment, AsaasService } from './asaas.service'
import { CheckoutService } from './checkout.service'

function make(couponOver: Partial<Record<string, unknown>> = {}) {
  const db: DrizzleMock = createDrizzleMock()
  const asaas = {
    ensureCustomer: jest.fn(async () => 'cus_1'),
    createPaymentLink: jest.fn(async () => ({ linkId: 'link_1', url: 'https://www.asaas.com/c/link_1' })),
    createInstallment: jest.fn<ReturnType<AsaasService['createInstallment']>, Parameters<AsaasService['createInstallment']>>(async () => ({
      chargeId: 'charge_1',
      installmentId: 'inst_1',
      paymentUrl: 'https://www.asaas.com/i/inst_1',
      dueDate: '2026-09-04',
    })),
    listInstallmentPayments: jest.fn<ReturnType<AsaasService['listInstallmentPayments']>, Parameters<AsaasService['listInstallmentPayments']>>(async () => []),
  }
  const installments = { recordFromPayments: jest.fn(async () => undefined) }
  const coupons = {
    validateAndCalc: jest.fn(async () => ({ discountInCents: 0, couponError: null, coupon: null })),
    alreadyRedeemed: jest.fn(async () => false),
    reserveUse: jest.fn(async () => true),
    releaseUse: jest.fn(async () => undefined),
    ...couponOver,
  }
  const members = { ensureStudentUnlessPlatform: jest.fn(async (): Promise<void> => undefined) }
  return {
    db,
    asaas,
    coupons,
    installments,
    members,
    service: new CheckoutService(db as never, asaas as never, coupons as never, installments as never, members as never),
  }
}

function row(id: string, price: number) {
  return {
    course: { id, slug: id, title: id, subtitle: null, kind: 'online', status: 'published', priceInCents: price, coverImageUrl: null },
    category: null,
    instructorName: null,
  }
}
const userRow = { uid: 'u1', email: 'a@x.com', displayName: 'Ana', asaasCustomerId: null, cpf: null }

/** Pagamento mínimo do Asaas. Sobrescreva só o que o teste precisa. */
function payment(over: Partial<AsaasPayment> = {}): AsaasPayment {
  return {
    id: 'pay_1',
    status: 'PENDING',
    value: 100,
    netValue: null,
    externalReference: null,
    paymentLink: null,
    installmentCount: null,
    billingType: null,
    installment: 'inst_1',
    installmentNumber: 1,
    dueDate: '2026-09-04',
    ...over,
  }
}

describe('CheckoutService: comprar garante o vínculo de aluno (B3)', () => {
  it('compra grátis: vínculo de aluno no polo da compra, depois de gravar as matrículas', async () => {
    const { db, service, members } = make()
    withQueryResults(db, [row('a', 0)], [], undefined)
    await service.checkout('t-a', 'u1', ['a'])
    expect(members.ensureStudentUnlessPlatform).toHaveBeenCalledWith('t-a', 'u1')
    expect(db.transaction.mock.invocationCallOrder[0]).toBeLessThan(members.ensureStudentUnlessPlatform.mock.invocationCallOrder[0])
  })

  it('compra paga: vínculo de aluno no polo da compra, depois de gravar o pedido', async () => {
    const { db, service, members } = make()
    withQueryResults(db, [row('a', 14900)], [], [userRow], undefined, undefined, undefined)
    await service.checkout('t-a', 'u1', ['a'], { cpf: '12345678909' })
    expect(members.ensureStudentUnlessPlatform).toHaveBeenCalledWith('t-a', 'u1')
    expect(db.transaction.mock.invocationCallOrder[0]).toBeLessThan(members.ensureStudentUnlessPlatform.mock.invocationCallOrder[0])
  })

  it('falha ao criar o vínculo não desfaz a compra nem devolve o cupom (o próximo login cria o vínculo)', async () => {
    const { db, service, members, coupons } = make({
      validateAndCalc: jest.fn(async () => ({ discountInCents: 0, couponError: null, coupon: null })),
    })
    jest.spyOn((service as unknown as { logger: { error: (m: string) => void } }).logger, 'error').mockImplementation(() => undefined)
    members.ensureStudentUnlessPlatform.mockRejectedValue(new Error('banco caiu'))
    withQueryResults(db, [row('a', 0)], [], undefined, undefined)
    const res = await service.checkout('t-a', 'u1', ['a'], { couponCode: 'GRATIS' })
    expect(res.enrollments).toHaveLength(1)
    expect(coupons.releaseUse).not.toHaveBeenCalled()
  })

  it('compra recusada não cria vínculo', async () => {
    const { db, service, members } = make()
    withQueryResults(db, [])
    await expect(service.checkout('t-a', 'u1', ['de-outro-polo'])).rejects.toThrow('Curso inválido no carrinho.')
    expect(members.ensureStudentUnlessPlatform).not.toHaveBeenCalled()
  })
})

describe('CheckoutService (carrinho)', () => {
  it('total 0 (curso grátis) → matrículas ativas sem Asaas', async () => {
    const { db, asaas, service } = make()
    withQueryResults(db, [row('a', 0)], [], undefined)
    const res = await service.checkout('t-a', 'u1', ['a'])
    expect(asaas.createPaymentLink).not.toHaveBeenCalled()
    expect(res.paymentUrl).toBeNull()
    expect(res.enrollments).toHaveLength(1)
    expect(res.enrollments[0].status).toBe('active')
  })

  it('só aceita cursos do polo da compra e grava o pedido com o polo', async () => {
    const { db, service } = make()
    // fila: cursos (vazia para curso de outro polo)
    withQueryResults(db, [])
    await expect(service.checkout('t-a', 'u1', ['c-de-outro-polo'])).rejects.toThrow('Curso inválido no carrinho.')
    const w = allWheres(db.where)[0]
    expect(w.sql).toContain('`courses`.`tenant_id` = ?')
    expect(w.params[0]).toBe('t-a')
  })

  it('pago sem CPF → 400', async () => {
    const { db, service } = make()
    withQueryResults(db, [row('a', 14900)], [], [userRow])
    await expect(service.checkout('t-a', 'u1', ['a'])).rejects.toBeInstanceOf(BadRequestException)
  })

  it('pago com CPF → cria order + matrículas pendentes + paymentUrl', async () => {
    const { db, asaas, service } = make()
    withQueryResults(db, [row('a', 14900), row('b', 9700)], [], [userRow], undefined, undefined, undefined)
    const res = await service.checkout('t-a', 'u1', ['a', 'b'], { cpf: '12345678909' })
    expect(asaas.createPaymentLink).toHaveBeenCalled()
    const calls = asaas.createPaymentLink.mock.calls as unknown as unknown[][]
    const linkArg = calls[0][0] as { amountInCents: number }
    expect(linkArg.amountInCents).toBe(24600)
    expect(res.paymentUrl).toBe('https://www.asaas.com/c/link_1')
    expect(res.enrollments).toHaveLength(0)
  })

  it('pago → grava asaasPaymentLinkId e deixa asaasChargeId nulo (o pagamento ainda não existe)', async () => {
    const { db, service } = make()
    withQueryResults(db, [row('a', 549700)], [], [userRow], undefined, undefined, undefined)
    await service.checkout('t-a', 'u1', ['a'], { cpf: '12345678909' })
    const inserted = (db.values.mock.calls as unknown[][])
      .map((c) => c[0])
      .find((v): v is Record<string, unknown> => !!v && typeof v === 'object' && 'asaasPaymentLinkId' in v)
    expect(inserted?.asaasPaymentLinkId).toBe('link_1')
    expect(inserted?.asaasChargeId).toBeNull()
  })

  it('pago → não cria mais customer no Asaas (o link não aceita customer)', async () => {
    const { db, asaas, service } = make()
    withQueryResults(db, [row('a', 549700)], [], [userRow], undefined, undefined, undefined)
    await service.checkout('t-a', 'u1', ['a'], { cpf: '12345678909' })
    expect(asaas.ensureCustomer).not.toHaveBeenCalled()
  })

  it('o externalReference do link é o orderId gravado no pedido', async () => {
    const { db, asaas, service } = make()
    withQueryResults(db, [row('a', 549700)], [], [userRow], undefined, undefined, undefined)
    await service.checkout('t-a', 'u1', ['a'], { cpf: '12345678909' })
    const calls = asaas.createPaymentLink.mock.calls as unknown as unknown[][]
    const ref = (calls[0][0] as { externalReference: string }).externalReference
    const inserted = (db.values.mock.calls as unknown[][])
      .map((c) => c[0])
      .find((v): v is Record<string, unknown> => !!v && typeof v === 'object' && 'asaasPaymentLinkId' in v)
    expect(inserted?.id).toBe(ref)
  })

  it('matrícula pendente duplicada (erro EMBRULHADO pelo Drizzle) → 409, não 500', async () => {
    // Reproduz o que a produção lançou: DrizzleQueryError com o erro do MySQL em `cause`.
    // O mock do projeto lançava o code na raiz, formato que o driver real não produz —
    // por isso 282 testes passavam enquanto o checkout devolvia 500.
    const { db, service } = make()
    withQueryResults(db, [row('a', 549700)], [], [{ ...userRow, cpf: '12345678909' }], undefined, undefined, undefined)
    const wrapped = new Error('Failed query: insert into `enrollments` ...')
    ;(wrapped as { cause?: unknown }).cause = Object.assign(
      new Error("Duplicate entry 'u1-a' for key 'enrollments.enrollments_user_course_unq'"),
      { code: 'ER_DUP_ENTRY' }
    )
    const chain = db.insert.getMockImplementation() as () => unknown
    let n = 0
    db.insert.mockImplementation(() => {
      n += 1
      if (n === 2) throw wrapped // o insert de enrollments, dentro da transação
      return chain()
    })
    await expect(service.checkout('t-a', 'u1', ['a'])).rejects.toBeInstanceOf(ConflictException)
  })

  it('curso com matrícula CANCELADA → recompra permitida, reusando a linha existente', async () => {
    // A unique (user_id, course_id) ignora o status: a linha cancelada continua ocupando
    // o lugar. Sem reusar, quem cancelou uma compra nunca mais compra aquele curso.
    const { db, asaas, service } = make()
    withQueryResults(
      db,
      [row('a', 549700)],
      [{ id: 'enr_velha', courseId: 'a', status: 'canceled' }],
      [{ ...userRow, cpf: '12345678909' }],
      undefined,
      undefined,
      undefined
    )
    const res = await service.checkout('t-a', 'u1', ['a'])
    expect(asaas.createPaymentLink).toHaveBeenCalled()
    expect(res.paymentUrl).toBe('https://www.asaas.com/c/link_1')
    // reusa via UPDATE; nada de INSERT de matrícula nova
    const setPatch = (db.set.mock.calls as unknown[][])
      .map((c) => c[0])
      .find((v): v is Record<string, unknown> => !!v && typeof v === 'object' && 'source' in v)
    expect(setPatch?.status).toBe('pending')
    expect(setPatch?.source).toBe('purchase')
  })

  it('carrinho com um curso JÁ MATRICULADO → recusa e NÃO cobra o resto', async () => {
    // Bug visto em produção: o carrinho somava R$ 799,90 (curso de R$ 500 já matriculado +
    // curso de R$ 299,90), o checkout descartava em silêncio o já matriculado e cobrava só
    // R$ 299,90 — em 2x, dois boletos de R$ 149,95 que não fecham com nada que o aluno viu.
    // O resumo do carrinho é público e nem recebe o aluno, então ele NUNCA vai saber
    // descontar sozinho: quem tem que recusar é o checkout.
    const { db, asaas, service } = make()
    withQueryResults(
      db,
      [row('a', 50000), row('b', 29990)],
      [{ id: 'enr_ativa', courseId: 'a', status: 'active' }]
    )
    await expect(service.checkout('t-a', 'u1', ['a', 'b'], { cpf: '12345678909' })).rejects.toBeInstanceOf(ConflictException)
    // o essencial: NENHUMA cobrança de valor parcial chegou a ser criada
    expect(asaas.createPaymentLink).not.toHaveBeenCalled()
    expect(asaas.createInstallment).not.toHaveBeenCalled()
  })

  it('carnê: recusa antes de gerar os boletos do carnê (não há como cancelar parcelamento no Asaas)', async () => {
    const { db, asaas, service } = make()
    withQueryResults(
      db,
      [row('a', 50000), row('b', 29990)],
      [{ id: 'enr_ativa', courseId: 'a', status: 'active' }]
    )
    await expect(
      service.checkout('t-a', 'u1', ['a', 'b'], { cpf: '12345678909', paymentMode: 'boleto_parcelado', installmentCount: 2 })
    ).rejects.toThrow(/já possui/i)
    expect(asaas.createInstallment).not.toHaveBeenCalled()
  })

  it('curso com matrícula PENDENTE → 409 com a mensagem certa, sem criar cobrança', async () => {
    const { db, asaas, service } = make()
    withQueryResults(db, [row('a', 549700)], [{ id: 'enr_p', courseId: 'a', status: 'pending' }])
    await expect(service.checkout('t-a', 'u1', ['a'], { cpf: '12345678909' })).rejects.toThrow(/compra pendente/i)
    expect(asaas.createPaymentLink).not.toHaveBeenCalled()
  })

  it('curso grátis com matrícula cancelada → reativa a linha em vez de inserir outra', async () => {
    const { db, service } = make()
    withQueryResults(db, [row('a', 0)], [{ id: 'enr_velha', courseId: 'a', status: 'canceled' }], undefined)
    const res = await service.checkout('t-a', 'u1', ['a'])
    expect(res.enrollments).toHaveLength(1)
    expect(res.enrollments[0].status).toBe('active')
    expect(res.enrollments[0].id).toBe('enr_velha')
  })

  it('repassa a escolha do aluno (parcelado) para o link', async () => {
    const { db, asaas, service } = make()
    withQueryResults(db, [row('a', 549700)], [], [{ ...userRow, cpf: '1' }], undefined, undefined, undefined)
    await service.checkout('t-a', 'u1', ['a'], { cpf: '12345678909', paymentMode: 'cartao_parcelado' })
    const calls = asaas.createPaymentLink.mock.calls as unknown as unknown[][]
    expect((calls[0][0] as { parcelado: boolean }).parcelado).toBe(true)
  })

  it('sem escolha explícita → à vista (o padrão nunca é parcelar)', async () => {
    const { db, asaas, service } = make()
    withQueryResults(db, [row('a', 549700)], [], [{ ...userRow, cpf: '1' }], undefined, undefined, undefined)
    await service.checkout('t-a', 'u1', ['a'], { cpf: '12345678909' })
    const calls = asaas.createPaymentLink.mock.calls as unknown as unknown[][]
    expect((calls[0][0] as { parcelado: boolean }).parcelado).toBe(false)
  })

  it('todos já possuídos → 409', async () => {
    const { db, service } = make()
    withQueryResults(db, [row('a', 14900)], [{ courseId: 'a', status: 'active' }])
    await expect(service.checkout('t-a', 'u1', ['a'], { cpf: '123' })).rejects.toBeInstanceOf(ConflictException)
  })

  it('cupom inválido → 400', async () => {
    const { db, service } = make({ validateAndCalc: jest.fn(async () => ({ discountInCents: 0, couponError: 'Cupom expirado.', coupon: null })) })
    withQueryResults(db, [row('a', 14900)], [])
    await expect(service.checkout('t-a', 'u1', ['a'], { couponCode: 'EXPIRADO', cpf: '123' })).rejects.toBeInstanceOf(BadRequestException)
  })

  it('cupom já resgatado pelo mesmo usuário → 400 e NÃO reserva o uso global', async () => {
    const { db, coupons, service } = make({
      validateAndCalc: jest.fn(async () => ({ discountInCents: 5000, couponError: null, coupon: null })),
      alreadyRedeemed: jest.fn(async () => true),
    })
    withQueryResults(db, [row('a', 5000)], [])
    await expect(service.checkout('t-a', 'u1', ['a'], { couponCode: 'PROMO' })).rejects.toBeInstanceOf(BadRequestException)
    expect(coupons.reserveUse).not.toHaveBeenCalled()
  })

  it('checkout grátis com cupom → registra o resgate em coupon_redemptions', async () => {
    const { db, service } = make({
      validateAndCalc: jest.fn(async () => ({ discountInCents: 5000, couponError: null, coupon: null })),
    })
    withQueryResults(db, [row('a', 5000)], [], undefined, undefined)
    const res = await service.checkout('t-a', 'u1', ['a'], { couponCode: 'PROMO' })
    expect(res.enrollments).toHaveLength(1)
    expect(db.insert).toHaveBeenCalledWith(couponRedemptions)
  })

  it('checkout pago com cupom → registra o resgate em coupon_redemptions', async () => {
    const { db, service } = make({
      validateAndCalc: jest.fn(async () => ({ discountInCents: 5000, couponError: null, coupon: null })),
    })
    // courses, enrollments, users, update(users), tx: redemption + order + enrollments
    withQueryResults(db, [row('a', 14900)], [], [userRow], undefined, undefined, undefined, undefined)
    const res = await service.checkout('t-a', 'u1', ['a'], { couponCode: 'PROMO', cpf: '12345678909' })
    expect(res.paymentUrl).toBe('https://www.asaas.com/c/link_1')
    expect(db.insert).toHaveBeenCalledWith(couponRedemptions)
    const insertedRedemption = (db.values.mock.calls as unknown[][])
      .map((c) => c[0])
      .find((v): v is Record<string, unknown> => !!v && typeof v === 'object' && 'couponCode' in v)
    expect(insertedRedemption).toEqual(expect.objectContaining({ tenantId: 't-a' }))
    const insertedOrder = (db.values.mock.calls as unknown[][])
      .map((c) => c[0])
      .find((v): v is Record<string, unknown> => !!v && typeof v === 'object' && 'asaasPaymentLinkId' in v)
    expect(insertedOrder).toEqual(expect.objectContaining({ tenantId: 't-a' }))
  })

  describe('boleto_parcelado (carnê)', () => {
    it('cria parcelamento por API (não link), persiste o asaasCustomerId e grava as parcelas listadas no Asaas', async () => {
      const { db, asaas, installments, service } = make()
      asaas.listInstallmentPayments = jest.fn<ReturnType<AsaasService['listInstallmentPayments']>, Parameters<AsaasService['listInstallmentPayments']>>(async () => [
        payment({ id: 'pay_1', installmentNumber: 1, dueDate: '2026-09-04' }),
        payment({ id: 'pay_2', installmentNumber: 2, dueDate: '2026-10-04' }),
      ])
      // Carrinho de R$ 500 em 5x — sem asaasCustomerId salvo, então precisa criar o customer.
      // Slots: courses, enrollments(inicial), users, persist-asaasCustomerId, recheck-enrollments, tx-orders, tx-enrollments.
      withQueryResults(db, [row('c1', 50000)], [], [{ ...userRow, cpf: '12345678909' }], undefined, [], undefined, undefined)

      await service.checkout('t-a', 'uid_1', ['c1'], { paymentMode: 'boleto_parcelado', installmentCount: 5, cpf: '12345678909' })

      expect(asaas.createPaymentLink).not.toHaveBeenCalled()
      expect(asaas.createInstallment).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: 'cus_1', installmentCount: 5, totalInCents: 50000 })
      )
      // A meia que falta: sem isso, apagar a linha de persistência deixaria a suíte toda verde
      // mesmo assim, e cada compra de carnê criaria um customer NOVO no Asaas para o mesmo CPF.
      const usersUpdatePatch = (db.set.mock.calls as unknown[][])
        .map((c) => c[0])
        .find((v): v is Record<string, unknown> => !!v && typeof v === 'object' && 'asaasCustomerId' in v)
      expect(usersUpdatePatch?.asaasCustomerId).toBe('cus_1')
      // orderId é gerado internamente (randomUUID) — pegamos o mesmo valor usado como
      // externalReference para confirmar que recordFromPayments recebeu o pedido certo.
      const orderId = (asaas.createInstallment.mock.calls[0][0] as { externalReference: string }).externalReference
      expect(installments.recordFromPayments).toHaveBeenCalledWith(
        orderId,
        expect.arrayContaining([expect.objectContaining({ id: 'pay_2' })])
      )
    })

    it('grava paymentMode, asaasInstallmentId, asaasCustomerId, installmentCount, paymentUrl e dueDate no pedido', async () => {
      const { db, service } = make()
      // Slots: courses, enrollments(inicial), users(com asaasCustomerId já salvo — sem persist), recheck-enrollments, tx-orders, tx-enrollments.
      withQueryResults(
        db,
        [row('c1', 50000)],
        [],
        [{ ...userRow, cpf: '12345678909', asaasCustomerId: 'cus_existing' }],
        [],
        undefined,
        undefined
      )
      await service.checkout('t-a', 'uid_1', ['c1'], { paymentMode: 'boleto_parcelado', installmentCount: 5, cpf: '12345678909' })
      const inserted = (db.values.mock.calls as unknown[][])
        .map((c) => c[0])
        .find((v): v is Record<string, unknown> => !!v && typeof v === 'object' && 'asaasPaymentLinkId' in v)
      expect(inserted?.paymentMode).toBe('boleto_parcelado')
      expect(inserted?.asaasInstallmentId).toBe('inst_1')
      expect(inserted?.asaasCustomerId).toBe('cus_existing')
      expect(inserted?.installmentCount).toBe(5)
      expect(inserted?.asaasPaymentLinkId).toBeNull()
      expect(inserted?.paymentUrl).toBe('https://www.asaas.com/i/inst_1')
      expect(inserted?.dueDate).toBe('2026-09-04')
    })

    it('reaproveita o asaasCustomerId já salvo (não cria customer duplicado no Asaas)', async () => {
      const { db, asaas, service } = make()
      withQueryResults(
        db,
        [row('c1', 50000)],
        [],
        [{ ...userRow, cpf: '12345678909', asaasCustomerId: 'cus_existing' }],
        [],
        undefined,
        undefined
      )
      await service.checkout('t-a', 'uid_1', ['c1'], { paymentMode: 'boleto_parcelado', installmentCount: 5, cpf: '12345678909' })
      expect(asaas.ensureCustomer).not.toHaveBeenCalled()
      expect(asaas.createInstallment).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'cus_existing' }))
    })

    it('recusa parcela abaixo do piso de R$ 10 (curso de R$ 40 em 5x = R$ 8/parcela)', async () => {
      const { db, asaas, service } = make()
      withQueryResults(db, [row('c_barato', 4000)], [], [{ ...userRow, cpf: '12345678909' }])
      await expect(
        service.checkout('t-a', 'uid_1', ['c_barato'], { paymentMode: 'boleto_parcelado', installmentCount: 5, cpf: '12345678909' })
        // Regex específica do piso: /parcela/i também casaria com "Escolha de 2 a 5 parcelas.",
        // então essa asserção passaria mesmo se o guard do piso sumisse e só sobrasse o de 2-5.
      ).rejects.toThrow(/R\$ 10,00/)
      expect(asaas.ensureCustomer).not.toHaveBeenCalled()
      expect(asaas.createInstallment).not.toHaveBeenCalled()
    })

    it('exige de 2 a 5 parcelas mesmo se o chamador não validar (DTO não é a única guarda)', async () => {
      const { db, asaas, service } = make()
      withQueryResults(db, [row('c1', 50000)], [], [{ ...userRow, cpf: '12345678909' }])
      await expect(
        service.checkout('t-a', 'uid_1', ['c1'], { paymentMode: 'boleto_parcelado', installmentCount: 6, cpf: '12345678909' })
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(asaas.createInstallment).not.toHaveBeenCalled()
    })

    it('exige CPF', async () => {
      const { db, service } = make()
      withQueryResults(db, [row('a', 14900)], [], [{ ...userRow, uid: 'u_sem_cpf', cpf: null }])
      await expect(
        service.checkout('t-a', 'uid_sem_cpf', ['a'], { paymentMode: 'boleto_parcelado', installmentCount: 5 })
      ).rejects.toThrow(/CPF/)
    })

    it('reconfere matrícula pendente na beira da chamada ao Asaas (corrida entre a consulta inicial e o parcelamento)', async () => {
      const { db, asaas, service } = make()
      // A consulta INICIAL (2º slot) não vê conflito nenhum; só o recheck (4º slot), feito bem
      // mais tarde no fluxo, encontra a matrícula pendente — como aconteceria se outro checkout
      // concorrente tivesse "furado" a fila nessa janela.
      withQueryResults(
        db,
        [row('c1', 50000)],
        [],
        [{ ...userRow, cpf: '12345678909', asaasCustomerId: 'cus_existing' }],
        [{ courseId: 'c1', status: 'pending' }]
      )
      await expect(
        service.checkout('t-a', 'uid_1', ['c1'], { paymentMode: 'boleto_parcelado', installmentCount: 5, cpf: '12345678909' })
      ).rejects.toThrow(/compra pendente/i)
      expect(asaas.createInstallment).not.toHaveBeenCalled()
    })

    it('falha ao listar/gravar as parcelas no Asaas NÃO derruba o checkout nem devolve o cupom já commitado', async () => {
      // O pedido, o resgate do cupom e as matrículas já foram COMMITADOS pela transação antes
      // deste ponto, e os boletos já existem de verdade no Asaas — um erro aqui só pode ser
      // logado; nunca pode acionar o catch externo (que devolveria o cupom e responderia com
      // erro para um pedido que, na prática, deu certo).
      const { db, asaas, coupons, installments, service } = make({
        validateAndCalc: jest.fn(async () => ({ discountInCents: 0, couponError: null, coupon: null })),
      })
      asaas.listInstallmentPayments = jest.fn<ReturnType<AsaasService['listInstallmentPayments']>, Parameters<AsaasService['listInstallmentPayments']>>(async () => {
        throw new Error('Asaas indisponível')
      })
      // Slots: courses, enrollments(inicial), users, recheck-enrollments, tx: coupon-redemption + orders + enrollments.
      withQueryResults(
        db,
        [row('c1', 50000)],
        [],
        [{ ...userRow, cpf: '12345678909', asaasCustomerId: 'cus_existing' }],
        [],
        undefined,
        undefined,
        undefined
      )
      const res = await service.checkout('t-a', 'uid_1', ['c1'], {
        paymentMode: 'boleto_parcelado',
        installmentCount: 5,
        cpf: '12345678909',
        couponCode: 'PROMO',
      })
      expect(res.paymentUrl).toBe('https://www.asaas.com/i/inst_1')
      expect(installments.recordFromPayments).not.toHaveBeenCalled()
      expect(coupons.releaseUse).not.toHaveBeenCalled()
    })
  })
})
