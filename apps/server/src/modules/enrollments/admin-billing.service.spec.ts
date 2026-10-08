/// <reference types="jest" />
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { createDrizzleMock, withQueryResults, type DrizzleMock } from '../../__test-utils__/drizzle-mock'
import { allWheres, renderSql } from '../../__test-utils__/sql'
import { tenantMembers } from '../../db/schema'
import { TenantMembersService } from '../tenancy/tenant-members.service'
import { AdminBillingService } from './admin-billing.service'

function make() {
  const db: DrizzleMock = createDrizzleMock()
  const asaas = {
    ensureCustomer: jest.fn(async () => 'cus_1'),
    createCharge: jest.fn(async () => ({
      chargeId: 'pay_1',
      paymentUrl: 'https://asaas/pay_1',
      status: 'PENDING',
      dueDate: '2026-09-10',
      billingType: 'UNDEFINED',
    })),
    createInstallment: jest.fn(async () => ({
      chargeId: 'pay_1',
      installmentId: 'ins_1',
      paymentUrl: 'https://asaas/ins_1',
      dueDate: '2026-09-10',
    })),
    listInstallmentPayments: jest.fn(async () => [
      { id: 'p1', installmentNumber: 1, value: 100, dueDate: '2026-09-10', invoiceUrl: 'u1' },
      { id: 'p2', installmentNumber: 2, value: 100, dueDate: '2026-10-10', invoiceUrl: 'u2' },
    ]),
    getPaymentBook: jest.fn(async () => Buffer.from('%PDF-carne')),
    deleteCharge: jest.fn(async () => undefined),
    deleteInstallment: jest.fn(async () => undefined),
  }
  return { db, asaas, service: new AdminBillingService(db as never, asaas as never, new TenantMembersService(db as never)) }
}

const aluno = { uid: 'u1', name: 'Maria', email: 'maria@x.com', cpf: '12345678901' }
/** Resultado do SELECT em tenant_members quando o aluno é do polo: a 1ª consulta de quem cobra ou abre a ficha. */
const membro: unknown[] = [{ roles: ['student'] }]
const curso = { id: 'c1', title: 'Grafologia', price: 50000, promo: null }

describe('AdminBillingService', () => {
  describe('travas antes de emitir boleto de verdade', () => {
    it('aluno sem CPF e sem CPF no formulário → recusa', async () => {
      const { db, asaas, service } = make()
      withQueryResults(db, membro, [{ ...aluno, cpf: null }])
      await expect(
        service.createCharge('t-a', 'admin', { userId: 'u1', courseIds: ['c1'], installmentCount: 1 })
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(asaas.ensureCustomer).not.toHaveBeenCalled()
    })

    it('aluno sem CPF mas com CPF no formulário → cria E SALVA o CPF no cadastro', async () => {
      // Aluno que nunca comprou não tem CPF, e era justamente quem esta tela precisa cobrar.
      // Salvar evita o admin digitar de novo na próxima cobrança.
      const { db, asaas, service } = make()
      withQueryResults(db, membro, [{ ...aluno, cpf: null }], undefined, [curso], [], undefined, undefined, undefined)
      await service.createCharge('t-a', 'admin', {
        userId: 'u1',
        courseIds: ['c1'],
        installmentCount: 1,
        cpf: '123.456.789-01',
      })
      expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ cpf: '12345678901' }))
      expect(asaas.ensureCustomer).toHaveBeenCalledWith(expect.objectContaining({ cpf: '12345678901' }))
    })

    it('CPF com menos de 11 dígitos → recusa antes de falar com o Asaas', async () => {
      const { db, asaas, service } = make()
      withQueryResults(db, membro, [{ ...aluno, cpf: null }])
      await expect(
        service.createCharge('t-a', 'admin', { userId: 'u1', courseIds: ['c1'], installmentCount: 1, cpf: '123' })
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(asaas.ensureCustomer).not.toHaveBeenCalled()
    })

    it('aluno inexistente → 404 e nada é criado', async () => {
      const { db, asaas, service } = make()
      withQueryResults(db, membro, [])
      await expect(
        service.createCharge('t-a', 'admin', { userId: 'sumido', courseIds: ['c1'], installmentCount: 1 })
      ).rejects.toBeInstanceOf(NotFoundException)
      expect(asaas.createCharge).not.toHaveBeenCalled()
    })

    it('aluno que não é do polo → 404 sem tocar no Asaas nem no banco', async () => {
      // O aluno existe na rede, mas o vínculo é com outro polo: para este polo ele não existe.
      const { db, asaas, service } = make()
      withQueryResults(db, [])
      const chamada = service.createCharge('t-a', 'admin', { userId: 'u-do-b', courseIds: ['c1'], installmentCount: 1 })
      await expect(chamada).rejects.toBeInstanceOf(NotFoundException)
      await expect(chamada).rejects.toThrow('Aluno não encontrado neste polo.')
      // A única ida ao banco foi a checagem do vínculo, feita NO POLO da requisição.
      expect(allWheres(db.where)).toEqual([
        { sql: '(`tenant_members`.`tenant_id` = ? and `tenant_members`.`user_uid` = ?)', params: ['t-a', 'u-do-b'] },
      ])
      expect(asaas.ensureCustomer).not.toHaveBeenCalled()
      expect(asaas.createCharge).not.toHaveBeenCalled()
      expect(db.insert).not.toHaveBeenCalled()
      expect(db.update).not.toHaveBeenCalled()
    })

    it('curso de outro polo → recusa antes de falar com o Asaas', async () => {
      // A consulta de cursos filtra pelo polo: o curso do B não volta e a contagem não bate.
      const { db, asaas, service } = make()
      withQueryResults(db, membro, [aluno], [])
      await expect(
        service.createCharge('t-a', 'admin', { userId: 'u1', courseIds: ['c-do-b'], installmentCount: 1 })
      ).rejects.toMatchObject({ message: 'Curso não encontrado.' })
      const doCurso = allWheres(db.where).find((w) => w.sql.includes('`courses`'))
      expect(doCurso?.sql).toContain('`courses`.`tenant_id` = ?')
      expect(doCurso?.params).toContain('t-a')
      expect(asaas.ensureCustomer).not.toHaveBeenCalled()
      expect(db.insert).not.toHaveBeenCalled()
    })

    it('mais de 5 parcelas → recusa (o Asaas cobra taxa por boleto emitido)', async () => {
      const { db, asaas, service } = make()
      withQueryResults(db, membro, [aluno])
      await expect(
        service.createCharge('t-a', 'admin', { userId: 'u1', courseIds: ['c1'], installmentCount: 9 })
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(asaas.createInstallment).not.toHaveBeenCalled()
    })

    it('curso que o aluno JÁ COMPROU → recusa', async () => {
      // Cobrar de novo por algo já pago é o erro mais caro que esta tela pode cometer.
      const { db, asaas, service } = make()
      withQueryResults(db, membro, [aluno], [curso], [{ id: 'e1', courseId: 'c1', status: 'active', source: 'purchase', orderId: 'o0' }])
      await expect(
        service.createCharge('t-a', 'admin', { userId: 'u1', courseIds: ['c1'], installmentCount: 1 })
      ).rejects.toMatchObject({ message: expect.stringMatching(/compra/) })
      expect(asaas.ensureCustomer).not.toHaveBeenCalled()
    })

    it('curso com cobrança EM ABERTO (matrícula pendente) → recusa explicando, em vez de estourar a chave única', async () => {
      const { db, asaas, service } = make()
      withQueryResults(db, membro, [aluno], [curso], [{ id: 'e1', courseId: 'c1', status: 'pending', source: 'purchase', orderId: 'o0' }])
      await expect(
        service.createCharge('t-a', 'admin', { userId: 'u1', courseIds: ['c1'], installmentCount: 1 })
      ).rejects.toMatchObject({ message: expect.stringMatching(/em aberto/) })
      expect(asaas.ensureCustomer).not.toHaveBeenCalled()
    })

    it('avulsa sem descrição → recusa (a ficha do aluno não teria o que mostrar)', async () => {
      const { db, service } = make()
      withQueryResults(db, membro, [aluno])
      await expect(
        service.createCharge('t-a', 'admin', { userId: 'u1', courseIds: [], amountInCents: 5000, installmentCount: 1 })
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('avulsa com valor zero ou negativo → recusa', async () => {
      const { db, service } = make()
      withQueryResults(db, membro, [aluno])
      await expect(
        service.createCharge('t-a', 'admin', { userId: 'u1', courseIds: [], description: 'Taxa', amountInCents: 0, installmentCount: 1 })
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('parcela abaixo do piso → recusa', async () => {
      // R$ 20,00 em 5x daria R$ 4,00 por boleto: a taxa do Asaas comeria a parcela.
      const { db, asaas, service } = make()
      withQueryResults(db, membro, [aluno], [{ ...curso, price: 2000 }], [])
      await expect(
        service.createCharge('t-a', 'admin', { userId: 'u1', courseIds: ['c1'], installmentCount: 5 })
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(asaas.createInstallment).not.toHaveBeenCalled()
    })
  })

  describe('criação', () => {
    it('carnê: grava o pedido, as matrículas PENDENTES e as parcelas', async () => {
      const { db, asaas, service } = make()
      withQueryResults(db, membro, [aluno], [curso], [], undefined, undefined, undefined, undefined, undefined)
      const r = await service.createCharge('t-a', 'admin1', { userId: 'u1', courseIds: ['c1'], installmentCount: 5 })
      expect(asaas.createInstallment).toHaveBeenCalledWith(
        expect.objectContaining({ totalInCents: 50000, installmentCount: 5, externalReference: expect.any(String) })
      )
      const pedido = db.values.mock.calls[0][0]
      expect(pedido).toEqual(
        expect.objectContaining({ userId: 'u1', totalInCents: 50000, status: 'pending', createdByAdmin: 'admin1' })
      )
      // Matrícula PENDENTE: quem ativa é o webhook, quando o dinheiro entra.
      const matriculas = db.values.mock.calls[1][0]
      expect(matriculas[0]).toEqual(expect.objectContaining({ courseId: 'c1', status: 'pending', orderId: pedido.id }))
      expect(r.paymentUrl).toBe('https://asaas/ins_1')
    })

    it('o pedido nasce no polo de quem cobra, nunca num polo fixo', async () => {
      const { db, service } = make()
      withQueryResults(db, membro, [aluno], undefined, undefined, undefined)
      await service.createCharge('t-z', 'admin1', {
        userId: 'u1',
        courseIds: [],
        description: 'Taxa de segunda via',
        amountInCents: 8000,
        installmentCount: 1,
      })
      expect(db.values.mock.calls[0][0]).toEqual(expect.objectContaining({ tenantId: 't-z', userId: 'u1' }))
    })

    it('avulsa: pedido SEM matrícula (pagar não libera nada) e com a descrição gravada', async () => {
      const { db, asaas, service } = make()
      withQueryResults(db, membro, [aluno], undefined, undefined, undefined)
      await service.createCharge('t-a', 'admin1', {
        userId: 'u1',
        courseIds: [],
        description: 'Taxa de segunda via',
        amountInCents: 8000,
        installmentCount: 1,
      })
      const pedido = db.values.mock.calls[0][0]
      expect(pedido.description).toBe('Taxa de segunda via')
      // Só o insert do pedido — nenhum insert de matrícula.
      expect(db.values.mock.calls).toHaveLength(1)
      expect(asaas.createCharge).toHaveBeenCalledWith(expect.objectContaining({ amountInCents: 8000 }))
    })

    it('preço PROMOCIONAL vence o cheio', async () => {
      // Cobrar o cheio geraria boleto divergente do que o aluno viu na vitrine.
      const { db, asaas, service } = make()
      withQueryResults(db, membro, [aluno], [{ ...curso, price: 50000, promo: 29900 }], [], undefined, undefined, undefined)
      await service.createCharge('t-a', 'admin1', { userId: 'u1', courseIds: ['c1'], installmentCount: 1 })
      expect(asaas.createCharge).toHaveBeenCalledWith(expect.objectContaining({ amountInCents: 29900 }))
    })

    it('falha do Asaas → CANCELA o pedido e as matrículas rascunhadas', async () => {
      // Sem isto sobra um pedido `pending` que nunca será pago, poluindo a ficha do aluno
      // e a fila de reconciliação para sempre.
      const { db, asaas, service } = make()
      asaas.createCharge.mockRejectedValueOnce(new Error('Asaas fora do ar'))
      withQueryResults(db, membro, [aluno], [curso], [], undefined, undefined, undefined, undefined)
      await expect(
        service.createCharge('t-a', 'admin1', { userId: 'u1', courseIds: ['c1'], installmentCount: 1 })
      ).rejects.toBeInstanceOf(BadRequestException)
      const cancelamentos = db.set.mock.calls.filter((c) => (c[0] as { status?: string }).status === 'canceled')
      expect(cancelamentos).toHaveLength(2) // o pedido e as matrículas
    })
  })

  describe('boleto para o admin', () => {
    it('carnê → devolve o livro de boletos', async () => {
      const { db, asaas, service } = make()
      withQueryResults(db, [{ installmentId: 'ins_1', chargeId: 'pay_1' }])
      const pdf = await service.boletoFor('t-a', 'o1')
      expect(asaas.getPaymentBook).toHaveBeenCalledWith('ins_1')
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    })

    it('pedido à vista → explica que o boleto está na fatura, em vez de estourar', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ installmentId: null, chargeId: 'pay_1' }])
      await expect(service.boletoFor('t-a', 'o1')).rejects.toBeInstanceOf(BadRequestException)
    })

    it('pedido de outro polo → 404 e o livro de boletos nem é pedido ao Asaas', async () => {
      const { db, asaas, service } = make()
      withQueryResults(db, [])
      await expect(service.boletoFor('t-a', 'o-do-b')).rejects.toBeInstanceOf(NotFoundException)
      expect(allWheres(db.where)[0]).toEqual({ sql: '(`orders`.`id` = ? and `orders`.`tenant_id` = ?)', params: ['o-do-b', 't-a'] })
      expect(asaas.getPaymentBook).not.toHaveBeenCalled()
    })
  })

  describe('busca de aluno', () => {
    it('termo curto não varre a tabela inteira', async () => {
      const { db, service } = make()
      expect(await service.searchStudents('t-a', 'ma')).toEqual([])
      expect(db.select).not.toHaveBeenCalled()
    })

    it('só acha quem é membro do polo: o vínculo entra no JOIN, com o polo da requisição', async () => {
      const { db, service } = make()
      withQueryResults(db, [aluno])
      expect(await service.searchStudents('t-a', 'maria')).toEqual([{ uid: 'u1', name: 'Maria', email: 'maria@x.com', cpf: '12345678901' }])
      const [tabela, condicao] = db.innerJoin.mock.calls[0]
      expect(tabela).toBe(tenantMembers)
      expect(renderSql(condicao)).toEqual({
        sql: '(`tenant_members`.`user_uid` = `users`.`uid` and `tenant_members`.`tenant_id` = ?)',
        params: ['t-a'],
      })
    })
  })

  describe('ficha financeira do aluno', () => {
    it('aluno que não é do polo → 404 e nenhuma outra consulta', async () => {
      const { db, service } = make()
      withQueryResults(db, [])
      const chamada = service.financeOf('t-a', 'u-do-b')
      await expect(chamada).rejects.toBeInstanceOf(NotFoundException)
      await expect(chamada).rejects.toThrow('Aluno não encontrado neste polo.')
      expect(db.select).toHaveBeenCalledTimes(1)
      expect(allWheres(db.where)[0].params).toEqual(['t-a', 'u-do-b'])
    })

    it('lista só os pedidos do polo (o aluno pode ter pedidos em outros)', async () => {
      const { db, service } = make()
      const pedido = { id: 'o1', status: 'pending', totalInCents: 50000 }
      withQueryResults(db, membro, [aluno], [pedido], [], [])
      const ficha = await service.financeOf('t-a', 'u1')
      expect(ficha.orders.map((o) => o.id)).toEqual(['o1'])
      expect(ficha.totalPendingInCents).toBe(50000)
      // 0: vínculo, 1: cadastro do aluno, 2: pedidos.
      expect(allWheres(db.where)[2]).toEqual({ sql: '(`orders`.`user_id` = ? and `orders`.`tenant_id` = ?)', params: ['u1', 't-a'] })
    })
  })

  describe('matricular junto', () => {
    it('enrollNow → matrícula nasce ATIVA (aluno estuda enquanto paga)', async () => {
      const { db, service } = make()
      withQueryResults(db, membro, [aluno], [curso], [], undefined, undefined, undefined, undefined)
      await service.createCharge('t-a', 'admin', { userId: 'u1', courseIds: ['c1'], installmentCount: 1, enrollNow: true })
      const matriculas = db.values.mock.calls[1][0]
      expect(matriculas[0]).toEqual(expect.objectContaining({ status: 'active' }))
      expect(matriculas[0].activatedAt).toBeInstanceOf(Date)
    })

    it('sem enrollNow → matrícula nasce PENDENTE (quem libera é o pagamento)', async () => {
      const { db, service } = make()
      withQueryResults(db, membro, [aluno], [curso], [], undefined, undefined, undefined, undefined)
      await service.createCharge('t-a', 'admin', { userId: 'u1', courseIds: ['c1'], installmentCount: 1 })
      const matriculas = db.values.mock.calls[1][0]
      expect(matriculas[0]).toEqual(expect.objectContaining({ status: 'pending', activatedAt: null }))
    })
  })

  describe('cancelamento', () => {
    it('cancela no ASAAS antes de marcar aqui — carnê apaga o PLANO inteiro', async () => {
      // Apagar boleto a boleto deixaria o plano vivo, gerando os próximos.
      const { db, asaas, service } = make()
      withQueryResults(db, [{ id: 'o1', status: 'pending', chargeId: 'pay_1', installmentId: 'ins_1' }])
      await service.cancelCharge('t-a', 'o1')
      expect(asaas.deleteInstallment).toHaveBeenCalledWith('ins_1')
      expect(asaas.deleteCharge).not.toHaveBeenCalled()
    })

    it('pedido à vista apaga a cobrança avulsa', async () => {
      const { db, asaas, service } = make()
      withQueryResults(db, [{ id: 'o1', status: 'pending', chargeId: 'pay_1', installmentId: null }])
      await service.cancelCharge('t-a', 'o1')
      expect(asaas.deleteCharge).toHaveBeenCalledWith('pay_1')
    })

    it('se o ASAAS recusar, NADA é marcado aqui', async () => {
      // Marcar mesmo assim deixaria o banco dizendo "cancelado" com o boleto vivo, e o
      // aluno pagaria algo que o admin acha que excluiu.
      const { db, asaas, service } = make()
      asaas.deleteInstallment.mockRejectedValueOnce(new Error('cobrança já confirmada'))
      withQueryResults(db, [{ id: 'o1', status: 'pending', chargeId: 'pay_1', installmentId: 'ins_1' }])
      await expect(service.cancelCharge('t-a', 'o1')).rejects.toThrow()
      expect(db.update).not.toHaveBeenCalled()
    })

    it('pedido PAGO não é cancelado por aqui', async () => {
      const { db, asaas, service } = make()
      withQueryResults(db, [{ id: 'o1', status: 'paid', chargeId: 'pay_1', installmentId: null }])
      await expect(service.cancelCharge('t-a', 'o1')).rejects.toBeInstanceOf(BadRequestException)
      expect(asaas.deleteCharge).not.toHaveBeenCalled()
    })

    it('pedido de outro polo → 404, sem cancelar no Asaas nem marcar nada', async () => {
      // Cancelar apaga o boleto de verdade: a trava do polo tem que vir ANTES de qualquer chamada externa.
      const { db, asaas, service } = make()
      withQueryResults(db, [])
      await expect(service.cancelCharge('t-a', 'o-do-b')).rejects.toBeInstanceOf(NotFoundException)
      expect(allWheres(db.where)[0]).toEqual({ sql: '(`orders`.`id` = ? and `orders`.`tenant_id` = ?)', params: ['o-do-b', 't-a'] })
      expect(asaas.deleteCharge).not.toHaveBeenCalled()
      expect(asaas.deleteInstallment).not.toHaveBeenCalled()
      expect(db.update).not.toHaveBeenCalled()
    })

    it('já cancelado é idempotente e não chama o Asaas de novo', async () => {
      const { db, asaas, service } = make()
      withQueryResults(db, [{ id: 'o1', status: 'canceled', chargeId: 'pay_1', installmentId: null }])
      expect(await service.cancelCharge('t-a', 'o1')).toEqual({ jaEstavaCancelado: true })
      expect(asaas.deleteCharge).not.toHaveBeenCalled()
    })
  })
})

describe('cobrança para quem já tem acesso de cortesia', () => {
  const cortesia = { id: 'e1', courseId: 'c1', status: 'active', source: 'free', orderId: null }

  it('matrícula ATIVA de cortesia NÃO barra: a cobrança reaproveita a matrícula e a liga ao pedido', async () => {
    // Liberar o acesso primeiro e cobrar depois é um fluxo legítimo da instituição. A linha
    // da matrícula é única por aluno+curso, então não pode nascer outra: a existente vira
    // "de compra" ligada ao pedido novo — o certificado passa a esperar a quitação e o
    // repasse do instrutor enxerga o curso do pedido.
    const { db, asaas, service } = make()
    withQueryResults(db, membro, [aluno], [curso], [cortesia], undefined, undefined, undefined, undefined)
    const r = await service.createCharge('t-a', 'admin', { userId: 'u1', courseIds: ['c1'], installmentCount: 1 })
    expect(asaas.createCharge).toHaveBeenCalled()
    const pedido = db.values.mock.calls[0][0]
    expect(db.values).toHaveBeenCalledTimes(1) // só o pedido: nenhuma matrícula nova
    const set = db.set.mock.calls[0][0]
    expect(set).toEqual(expect.objectContaining({ orderId: pedido.id, source: 'purchase', status: 'active' }))
    expect('activatedAt' in set).toBe(false) // o acesso já dado não é "reativado" nem retirado
    expect(r.orderId).toBe(pedido.id)
  })

  it('cortesia ativa continua ATIVA mesmo sem "matricular agora"', async () => {
    const { db, service } = make()
    withQueryResults(db, membro, [aluno], [curso], [cortesia], undefined, undefined, undefined, undefined)
    await service.createCharge('t-a', 'admin', { userId: 'u1', courseIds: ['c1'], installmentCount: 1, enrollNow: false })
    expect(db.set.mock.calls[0][0]).toEqual(expect.objectContaining({ status: 'active' }))
  })

  it('matrícula CANCELADA é reaproveitada, com acesso conforme "matricular agora"', async () => {
    const cancelada = { ...cortesia, status: 'canceled' }
    const a = make()
    withQueryResults(a.db, membro, [aluno], [curso], [cancelada], undefined, undefined, undefined, undefined)
    await a.service.createCharge('t-a', 'admin', { userId: 'u1', courseIds: ['c1'], installmentCount: 1 })
    expect(a.db.set.mock.calls[0][0]).toEqual(expect.objectContaining({ source: 'purchase', status: 'pending', activatedAt: null }))

    const b = make()
    withQueryResults(b.db, membro, [aluno], [curso], [cancelada], undefined, undefined, undefined, undefined)
    await b.service.createCharge('t-a', 'admin', { userId: 'u1', courseIds: ['c1'], installmentCount: 1, enrollNow: true })
    expect(b.db.set.mock.calls[0][0]).toEqual(expect.objectContaining({ status: 'active', activatedAt: expect.any(Date) }))
  })

  it('curso misto: reaproveita o que existe e insere só o curso novo', async () => {
    const curso2 = { id: 'c2', title: 'Tricologia', price: 30000, promo: null }
    const { db, service } = make()
    withQueryResults(db, membro, [aluno], [curso, curso2], [cortesia], undefined, undefined, undefined, undefined, undefined)
    await service.createCharge('t-a', 'admin', { userId: 'u1', courseIds: ['c1', 'c2'], installmentCount: 1 })
    const pedido = db.values.mock.calls[0][0]
    expect(pedido.totalInCents).toBe(80000)
    const novas = db.values.mock.calls[1][0]
    expect(novas).toHaveLength(1)
    expect(novas[0]).toEqual(expect.objectContaining({ courseId: 'c2', orderId: pedido.id, status: 'pending' }))
    expect(db.set.mock.calls[0][0]).toEqual(expect.objectContaining({ orderId: pedido.id, source: 'purchase' }))
  })

  it('falha do Asaas DEVOLVE a cortesia ao estado anterior em vez de cancelá-la', async () => {
    const { db, asaas, service } = make()
    asaas.createCharge.mockRejectedValueOnce(new Error('Asaas fora'))
    withQueryResults(db, membro, [aluno], [curso], [cortesia], undefined, undefined, undefined, undefined, undefined)
    await expect(
      service.createCharge('t-a', 'admin', { userId: 'u1', courseIds: ['c1'], installmentCount: 1 })
    ).rejects.toBeInstanceOf(BadRequestException)
    const sets = db.set.mock.calls.map((c) => c[0] as Record<string, unknown>)
    // O aluno tinha acesso de cortesia antes da tentativa: continua tendo depois dela.
    expect(sets).toContainEqual(expect.objectContaining({ status: 'active', source: 'free', orderId: null }))
  })
})

describe('vencimento', () => {
  it('data no passado é recusada ANTES de criar o pedido ou falar com o Asaas', async () => {
    // Validar só na chamada ao Asaas criava o pedido, falhava e cancelava — trabalho e
    // ruído na ficha do aluno por algo que dá para recusar de cara.
    const { db, asaas, service } = make()
    withQueryResults(db, membro, [aluno], [curso], [])
    await expect(
      service.createCharge('t-a', 'admin', { userId: 'u1', courseIds: ['c1'], installmentCount: 1, dueDate: '2020-01-01' })
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(db.insert).not.toHaveBeenCalled()
    expect(asaas.ensureCustomer).not.toHaveBeenCalled()
  })

  it('vencimento escolhido chega ao Asaas', async () => {
    const { db, asaas, service } = make()
    const amanha = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
    withQueryResults(db, membro, [aluno], [curso], [], undefined, undefined, undefined, undefined)
    await service.createCharge('t-a', 'admin', { userId: 'u1', courseIds: ['c1'], installmentCount: 1, dueDate: amanha })
    expect(asaas.createCharge).toHaveBeenCalledWith(expect.objectContaining({ dueDate: amanha }))
  })
})
