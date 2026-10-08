import { randomUUID } from 'node:crypto'
import { EarningsService } from '../../src/modules/finance/earnings.service'
import { bootTestApp, type TestApp } from './helpers/app'
import { createTestDatabase, type TestDatabase } from './helpers/db'
import { bearer, seedEnrollment, seedMember, seedOrder, seedTwoPolos, seedUser, type TwoPolos } from './helpers/seed'
import { eventually } from './helpers/wait'

describe('financeiro e cobranças por polo', () => {
  let t: TestDatabase
  let app: TestApp
  let w: TwoPolos
  /** Pedidos em aberto do aluno 'u-cobrado', que estuda na matriz e no polo A. */
  let pedidos: { matriz: string; a: string }

  async function ganho(tenantId: string, courseId: string, instructorId: string, net: number) {
    const orderId = await seedOrder(t, { tenantId, userId: w.u.shared, totalInCents: net * 2 })
    await t.pool.query(
      'INSERT INTO earnings (id, tenant_id, order_id, course_id, instructor_id, gross_in_cents, commission_percent, net_in_cents) VALUES (?, ?, ?, ?, ?, ?, 50, ?)',
      [randomUUID(), tenantId, orderId, courseId, instructorId, net * 2, net]
    )
  }

  beforeAll(async () => {
    t = await createTestDatabase()
    app = await bootTestApp(t.url)
    w = await seedTwoPolos(t)
    await seedMember(t, w.b.id, w.u.teacherA, ['teacher']) // o mesmo professor leciona no A e no B
    await ganho(w.a.id, w.courses.a.id, w.u.teacherA, 1000)
    await ganho(w.b.id, w.courses.b.id, w.u.teacherA, 300)
    await ganho(w.matriz.id, w.courses.matriz.id, w.u.adminMatriz, 5000)
    // Aluno de dois polos (com CPF, para a cobrança emitir sem pedir o documento), com um pedido em aberto em cada um.
    await seedUser(t, { uid: 'u-cobrado', cpf: '52998224725' })
    await seedMember(t, w.matriz.id, 'u-cobrado', ['student'])
    await seedMember(t, w.a.id, 'u-cobrado', ['student'])
    pedidos = {
      matriz: await seedOrder(t, { tenantId: w.matriz.id, userId: 'u-cobrado', status: 'pending' }),
      a: await seedOrder(t, { tenantId: w.a.id, userId: 'u-cobrado', status: 'pending' }),
    }
  })
  afterAll(async () => {
    try {
      await app?.close()
    } finally {
      await t?.drop()
    }
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  const como = (host: string, uid: string) => ({ Host: host, Authorization: bearer(uid) })
  const comoAdminMatriz = () => como(w.matriz.host, w.u.adminMatriz)
  const consulta = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => (await t.pool.query(sql, params))[0] as T[]
  const auditoria = (action: string) =>
    eventually(
      async () => consulta<{ tenant_id: string | null }>('SELECT tenant_id FROM audit_logs WHERE action = ?', [action]),
      (v) => v.length > 0
    )

  // Os testes dependem da ordem: o mundo semeado vai mudando (repasse registrado, comissão trocada,
  // pedidos baixados e cobranças emitidas). Os que só leem vêm antes dos que gravam.

  it('cada polo vê só o próprio financeiro', async () => {
    const a = await app.http().get('/api/admin/finance').set('Host', w.a.host).set('Authorization', bearer(w.u.adminA))
    expect(a.body.netInCents).toBe(1000)
    const m = await app.http().get('/api/admin/finance').set('Host', w.matriz.host).set('Authorization', bearer(w.u.platform))
    expect(m.body.netInCents).toBe(5000)
    const b = await app.http().get('/api/admin/finance').set(como(w.b.host, w.u.adminB))
    expect(b.body.netInCents).toBe(300)
  })

  it('o resumo traz só os parceiros e as vendas do polo, e a plataforma vê o polo do endereço', async () => {
    const a = await app.http().get('/api/admin/finance').set(como(w.a.host, w.u.adminA))
    expect(a.body).toMatchObject({ grossInCents: 2000, asaasFeeInCents: 0, commissionInCents: 1000, netInCents: 1000 })
    expect((a.body.instructors as Array<{ instructorId: string }>).map((i) => i.instructorId)).toEqual([w.u.teacherA])
    expect(a.body.sales).toHaveLength(1)
    expect(a.body.sales[0]).toMatchObject({ grossInCents: 2000, netInCents: 1000, buyerEmail: `${w.u.shared}@teste.local` })
    const m = await app.http().get('/api/admin/finance').set(como(w.matriz.host, w.u.adminMatriz))
    expect((m.body.instructors as Array<{ instructorId: string }>).map((i) => i.instructorId)).toEqual([w.u.adminMatriz])
    expect(m.body.sales).toHaveLength(1)
    // A equipe da plataforma, no endereço do polo A, vê o financeiro do A, não o da rede.
    const plataformaNoA = await app.http().get('/api/admin/finance').set(como(w.a.host, w.u.platform))
    expect(plataformaNoA.body.netInCents).toBe(1000)
  })

  it('o instrutor de dois polos vê em cada um só os ganhos daquele polo', async () => {
    const a = await app.http().get('/api/instructor/earnings').set('Host', w.a.host).set('Authorization', bearer(w.u.teacherA))
    const b = await app.http().get('/api/instructor/earnings').set('Host', w.b.host).set('Authorization', bearer(w.u.teacherA))
    expect(a.body.netInCents).toBe(1000)
    expect(b.body.netInCents).toBe(300)
  })

  it('polo sem venda não abre pedidos nem cobranças, com a mensagem para quem administra (B5)', async () => {
    const auth = { Host: w.a.host, Authorization: bearer(w.u.adminA) }
    const esperado = { statusCode: 403, code: 'TENANT_SALES_DISABLED', message: 'Este polo ainda não vende pela plataforma.' }
    expect((await app.http().get('/api/admin/orders').set(auth)).body).toEqual(esperado)
    expect((await app.http().get('/api/admin/billing/students?q=alu').set(auth)).body).toEqual(esperado)
  })

  it('a trava de venda cobre TODAS as rotas de pedidos e cobranças, também para a plataforma', async () => {
    const rotas: Array<['get' | 'post' | 'delete', string]> = [
      ['get', '/api/admin/orders'],
      ['post', `/api/admin/orders/${pedidos.a}/settle`],
      ['post', `/api/admin/orders/${pedidos.a}/cancel`],
      ['post', `/api/admin/orders/${pedidos.a}/settle-carne`],
      ['get', '/api/admin/billing/students?q=cobrado'],
      ['get', '/api/admin/billing/students/u-cobrado'],
      ['post', '/api/admin/billing/charges'],
      ['delete', `/api/admin/billing/orders/${pedidos.a}`],
      ['get', `/api/admin/billing/orders/${pedidos.a}/carne`],
    ]
    for (const quem of [como(w.a.host, w.u.adminA), como(w.a.host, w.u.platform)]) {
      for (const [metodo, url] of rotas) {
        const r = await app.http()[metodo](url).set(quem)
        expect([metodo, url, r.status, r.body.code]).toEqual([metodo, url, 403, 'TENANT_SALES_DISABLED'])
      }
    }
    // Nada foi mexido: o pedido do A segue em aberto e sem cobrança emitida.
    expect(await consulta('SELECT status FROM orders WHERE id = ?', [pedidos.a])).toEqual([{ status: 'pending' }])
  })

  it('a busca de alunos da cobrança na matriz só acha membros da matriz', async () => {
    const busca = (q: string) => app.http().get(`/api/admin/billing/students?q=${q}`).set('Host', w.matriz.host).set('Authorization', bearer(w.u.platform))
    expect((await busca(w.u.studentA)).body.students).toEqual([])
    expect((await busca(w.u.adminMatriz)).body.students.map((s: { uid: string }) => s.uid)).toEqual([w.u.adminMatriz])
    // Quem estuda na matriz E em outro polo aparece (pelo vínculo com a matriz), por nome ou por CPF.
    expect((await busca('cobrado')).body.students.map((s: { uid: string }) => s.uid)).toEqual(['u-cobrado'])
    expect((await busca('529.982.247-25')).body.students.map((s: { uid: string }) => s.uid)).toEqual(['u-cobrado'])
  })

  it('a conciliação do Asaas é só da plataforma', async () => {
    // Admin de polo não concilia. (O admin da matriz concilia: é admin da plataforma pela tela da matriz, B10.)
    expect((await app.http().post('/api/admin/reconcile-asaas').set('Host', w.a.host).set('Authorization', bearer(w.u.adminA))).status).toBe(403)
    expect((await app.http().post('/api/admin/reconcile-asaas').set('Host', w.matriz.host).set('Authorization', bearer(w.u.adminA))).status).toBe(403)
    // O dublê do Asaas lança em getPayment de propósito. A conciliação não passa por ele: consulta
    // listPaymentsByExternalReference e listInstallmentPayments, que o dublê responde com lista vazia.
    // Por isso a rota termina de verdade (201 com o resultado), sem nenhuma falha de consulta.
    const r = await app.http().post('/api/admin/reconcile-asaas').set('Host', w.matriz.host).set('Authorization', bearer(w.u.platform))
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ reconciled: 0, failed: 0 })
    expect(typeof r.body.checked).toBe('number')
    // A conta Asaas é única: a ação é da plataforma e fica no log sem polo.
    expect(await auditoria('asaas.reconcile')).toEqual([{ tenant_id: null }])
  })

  it('comissão e repasse fora do polo respondem 404', async () => {
    const auth = { Host: w.a.host, Authorization: bearer(w.u.adminA) }
    expect((await app.http().patch(`/api/admin/courses/${w.courses.b.id}/commission`).set(auth).send({ commissionPercent: 30 })).status).toBe(404)
    expect((await app.http().post('/api/admin/payouts').set(auth).send({ instructorId: w.u.teacherB, amountInCents: 100 })).status).toBe(404)
    // E nada foi gravado: a comissão do curso do B segue a de origem e não há repasse nenhum.
    expect(await consulta('SELECT commission_percent FROM courses WHERE id = ?', [w.courses.b.id])).toEqual([{ commission_percent: 50 }])
    expect(await consulta('SELECT id FROM payouts')).toEqual([])
  })

  it('o repasse registrado vale só no polo do endereço', async () => {
    const r = await app.http().post('/api/admin/payouts').set(como(w.a.host, w.u.adminA)).send({ instructorId: w.u.teacherA, amountInCents: 400, note: 'PIX' })
    expect(r.status).toBe(201)
    expect(r.body.payout).toMatchObject({ amountInCents: 400, note: 'PIX' })
    expect(await consulta('SELECT tenant_id, instructor_id, amount_in_cents FROM payouts')).toEqual([
      { tenant_id: w.a.id, instructor_id: w.u.teacherA, amount_in_cents: 400 },
    ])
    // O mesmo professor: no A o repasse abate o que se deve; no B nada mudou.
    const noA = await app.http().get('/api/instructor/earnings').set(como(w.a.host, w.u.teacherA))
    expect(noA.body).toMatchObject({ netInCents: 1000, paidInCents: 400, owedInCents: 600 })
    expect(noA.body.payouts).toHaveLength(1)
    const noB = await app.http().get('/api/instructor/earnings').set(como(w.b.host, w.u.teacherA))
    expect(noB.body).toEqual({ netInCents: 300, paidInCents: 0, owedInCents: 300, payouts: [] })
    // O resumo de cada polo também só enxerga o repasse do próprio polo.
    const resumoA = await app.http().get('/api/admin/finance').set(como(w.a.host, w.u.adminA))
    expect(resumoA.body.instructors).toEqual([expect.objectContaining({ instructorId: w.u.teacherA, netInCents: 1000, paidInCents: 400, owedInCents: 600 })])
    const resumoB = await app.http().get('/api/admin/finance').set(como(w.b.host, w.u.adminB))
    expect(resumoB.body.instructors).toEqual([expect.objectContaining({ instructorId: w.u.teacherA, netInCents: 300, paidInCents: 0, owedInCents: 300 })])
    expect(await auditoria('payout.register')).toEqual([{ tenant_id: w.a.id }])
  })

  it('a comissão muda só o curso do polo do endereço', async () => {
    const r = await app.http().patch(`/api/admin/courses/${w.courses.a.id}/commission`).set(como(w.a.host, w.u.adminA)).send({ commissionPercent: 30 })
    expect([r.status, r.body]).toEqual([200, { commissionPercent: 30 }])
    const porCurso = async (id: string) => (await consulta<{ commission_percent: number }>('SELECT commission_percent FROM courses WHERE id = ?', [id]))[0].commission_percent
    expect(await porCurso(w.courses.a.id)).toBe(30)
    expect(await porCurso(w.courses.b.id)).toBe(50)
    expect(await porCurso(w.courses.matriz.id)).toBe(50)
    expect(await auditoria('course.commission')).toEqual([{ tenant_id: w.a.id }])
  })

  it('a lista de pedidos do admin é só do polo do endereço', async () => {
    const r = await app.http().get('/api/admin/orders').set(comoAdminMatriz())
    expect(r.status).toBe(200)
    const ids = (r.body.orders as Array<{ id: string }>).map((o) => o.id).sort()
    const daMatriz = (await consulta<{ id: string }>('SELECT id FROM orders WHERE tenant_id = ?', [w.matriz.id])).map((o) => o.id).sort()
    expect(ids).toEqual(daMatriz)
    expect(ids).toContain(pedidos.matriz)
    expect(ids).not.toContain(pedidos.a)
    // Há pedidos de outros polos no banco (o que prova que a lista foi filtrada, e não que só havia estes).
    expect((await consulta<{ n: number }>('SELECT COUNT(*) AS n FROM orders'))[0].n).toBeGreaterThan(daMatriz.length)
  })

  it('a ficha financeira do aluno traz só os pedidos do polo; aluno de outro polo responde 404', async () => {
    const r = await app.http().get('/api/admin/billing/students/u-cobrado').set(comoAdminMatriz())
    expect(r.status).toBe(200)
    // O aluno também tem pedido em aberto no A, que a matriz não enxerga.
    expect((r.body.orders as Array<{ id: string }>).map((o) => o.id)).toEqual([pedidos.matriz])
    expect(r.body.student).toMatchObject({ uid: 'u-cobrado', cpf: '52998224725' })
    const deFora = await app.http().get(`/api/admin/billing/students/${w.u.studentA}`).set(comoAdminMatriz())
    expect([deFora.status, deFora.body.message]).toEqual([404, 'Aluno não encontrado neste polo.'])
  })

  it('baixa, cancelamento e quitação de pedido de outro polo respondem 404 e o pedido não muda', async () => {
    for (const quem of [comoAdminMatriz(), como(w.matriz.host, w.u.platform)]) {
      for (const acao of ['settle', 'cancel', 'settle-carne']) {
        const r = await app.http().post(`/api/admin/orders/${pedidos.a}/${acao}`).set(quem)
        expect([acao, r.status, r.body.message]).toEqual([acao, 404, 'Pedido não encontrado.'])
      }
    }
    expect(await consulta('SELECT status, settled_at FROM orders WHERE id = ?', [pedidos.a])).toEqual([{ status: 'pending', settled_at: null }])
  })

  it('baixa, cancelamento e quitação do pedido do polo funcionam', async () => {
    const aBaixar = pedidos.matriz
    const aCancelar = await seedOrder(t, { tenantId: w.matriz.id, userId: w.u.adminMatriz, status: 'pending' })
    const aQuitar = await seedOrder(t, { tenantId: w.matriz.id, userId: w.u.adminMatriz, status: 'paid' })
    const baixa = await app.http().post(`/api/admin/orders/${aBaixar}/settle`).set(comoAdminMatriz())
    expect([baixa.status, baixa.body]).toEqual([201, { alreadyPaid: false }])
    const cancela = await app.http().post(`/api/admin/orders/${aCancelar}/cancel`).set(comoAdminMatriz())
    expect([cancela.status, cancela.body]).toEqual([201, { alreadyCanceled: false }])
    const quita = await app.http().post(`/api/admin/orders/${aQuitar}/settle-carne`).set(comoAdminMatriz())
    expect([quita.status, quita.body]).toEqual([201, { alreadySettled: false }])
    const estado = (id: string) => consulta<{ status: string; settled: number }>('SELECT status, settled_at IS NOT NULL AS settled FROM orders WHERE id = ?', [id])
    expect(await estado(aBaixar)).toEqual([{ status: 'paid', settled: 1 }])
    expect(await estado(aCancelar)).toEqual([{ status: 'canceled', settled: 0 }])
    expect(await estado(aQuitar)).toEqual([{ status: 'paid', settled: 1 }])
    // As três ações ficam no log do polo da matriz.
    const logs = await eventually(
      async () => consulta<{ tenant_id: string }>("SELECT tenant_id FROM audit_logs WHERE action IN ('order.settle_manual', 'order.cancel_manual', 'order.settle_carne_manual')"),
      (v) => v.length >= 3
    )
    expect(logs).toEqual([{ tenant_id: w.matriz.id }, { tenant_id: w.matriz.id }, { tenant_id: w.matriz.id }])
  })

  it('a cobrança recusa aluno e curso de outro polo, sem emitir nada no Asaas', async () => {
    const cliente = jest.spyOn(app.fakes.asaas, 'ensureCustomer')
    const cobranca = jest.spyOn(app.fakes.asaas, 'createCharge')
    const carne = jest.spyOn(app.fakes.asaas, 'createInstallment')
    const total = async () => (await consulta<{ n: number }>('SELECT COUNT(*) AS n FROM orders'))[0].n
    const antes = await total()
    const cobrar = (corpo: object) => app.http().post('/api/admin/billing/charges').set(comoAdminMatriz()).send(corpo)

    // Aluno que só estuda no polo A.
    const deOutroPolo = await cobrar({ userId: w.u.studentA, description: 'Taxa', amountInCents: 5000, installmentCount: 1 })
    expect([deOutroPolo.status, deOutroPolo.body.message]).toEqual([404, 'Aluno não encontrado neste polo.'])
    // Aluno da matriz, mas curso do polo A (sozinho ou misturado com um da matriz).
    const cursoDeFora = await cobrar({ userId: 'u-cobrado', courseIds: [w.courses.a.id], installmentCount: 1 })
    expect([cursoDeFora.status, cursoDeFora.body.message]).toEqual([400, 'Curso não encontrado.'])
    const misturado = await cobrar({ userId: 'u-cobrado', courseIds: [w.courses.matriz.id, w.courses.a.id], installmentCount: 1 })
    expect([misturado.status, misturado.body.message]).toEqual([400, 'Curso não encontrado.'])

    expect(cliente).not.toHaveBeenCalled()
    expect(cobranca).not.toHaveBeenCalled()
    expect(carne).not.toHaveBeenCalled()
    expect(await total()).toBe(antes)
    // Nenhuma matrícula nasceu: o aluno cobrado não tem nenhuma, e o aluno do A segue só com a do seed.
    expect(await consulta('SELECT id FROM enrollments WHERE user_id = ?', ['u-cobrado'])).toEqual([])
    expect(await consulta('SELECT course_id FROM enrollments WHERE user_id = ?', [w.u.studentA])).toEqual([{ course_id: w.courses.a.id }])
  })

  it('a cobrança avulsa nasce no polo e só o polo a cancela', async () => {
    const cobranca = jest.spyOn(app.fakes.asaas, 'createCharge')
    const apagar = jest.spyOn(app.fakes.asaas, 'deleteCharge')
    const r = await app.http().post('/api/admin/billing/charges').set(comoAdminMatriz()).send({ userId: 'u-cobrado', description: 'Taxa de segunda via', amountInCents: 8000, installmentCount: 1 })
    expect(r.status).toBe(201)
    expect(r.body).toEqual({ orderId: expect.any(String), paymentUrl: 'https://asaas.fake/pay' })
    expect(cobranca).toHaveBeenCalledTimes(1)
    expect(await consulta('SELECT tenant_id, user_id, status, total_in_cents, created_by_admin, asaas_charge_id FROM orders WHERE id = ?', [r.body.orderId])).toEqual([
      { tenant_id: w.matriz.id, user_id: 'u-cobrado', status: 'pending', total_in_cents: 8000, created_by_admin: w.u.adminMatriz, asaas_charge_id: 'pay_fake' },
    ])
    expect(await auditoria('billing.charge.create')).toEqual([{ tenant_id: w.matriz.id }])

    // Cancelar pedido de outro polo: 404, e o Asaas nem é chamado (cancelar lá apaga o boleto de verdade).
    const deFora = await app.http().delete(`/api/admin/billing/orders/${pedidos.a}`).set(comoAdminMatriz())
    expect([deFora.status, deFora.body.message]).toEqual([404, 'Pedido não encontrado.'])
    expect(apagar).not.toHaveBeenCalled()
    expect(await consulta('SELECT status FROM orders WHERE id = ?', [pedidos.a])).toEqual([{ status: 'pending' }])

    const cancela = await app.http().delete(`/api/admin/billing/orders/${r.body.orderId}`).set(comoAdminMatriz())
    expect([cancela.status, cancela.body]).toEqual([200, { jaEstavaCancelado: false }])
    expect(apagar).toHaveBeenCalledWith('pay_fake')
    expect(await consulta('SELECT status FROM orders WHERE id = ?', [r.body.orderId])).toEqual([{ status: 'canceled' }])
  })

  it('o carnê da cobrança com curso nasce no polo, com matrícula pendente, e o PDF só sai do pedido do polo', async () => {
    const r = await app.http().post('/api/admin/billing/charges').set(comoAdminMatriz()).send({ userId: 'u-cobrado', courseIds: [w.courses.matriz.id], installmentCount: 2 })
    expect(r.status).toBe(201)
    expect(r.body.paymentUrl).toBe('https://asaas.fake/carne')
    expect(await consulta('SELECT tenant_id, total_in_cents, asaas_installment_id FROM orders WHERE id = ?', [r.body.orderId])).toEqual([
      { tenant_id: w.matriz.id, total_in_cents: 10000, asaas_installment_id: 'ins_fake' },
    ])
    expect(await consulta('SELECT course_id, status, source, order_id FROM enrollments WHERE user_id = ?', ['u-cobrado'])).toEqual([
      { course_id: w.courses.matriz.id, status: 'pending', source: 'purchase', order_id: r.body.orderId },
    ])

    const pdf = await app.http().get(`/api/admin/billing/orders/${r.body.orderId}/carne`).set(comoAdminMatriz())
    expect(pdf.status).toBe(200)
    expect(pdf.headers['content-type']).toContain('application/pdf')
    expect(Buffer.from(pdf.body).toString().startsWith('%PDF-')).toBe(true)

    const livroDeFora = jest.spyOn(app.fakes.asaas, 'getPaymentBook')
    const deFora = await app.http().get(`/api/admin/billing/orders/${pedidos.a}/carne`).set(comoAdminMatriz())
    expect([deFora.status, deFora.body.message]).toEqual([404, 'Pedido não encontrado.'])
    expect(livroDeFora).not.toHaveBeenCalled()
  })

  it('o ganho capturado nasce no polo do pedido (à vista e por parcela) e entra no financeiro daquele polo', async () => {
    // A matriz tem o mesmo id da constante provisória que a captura usava: pedido da matriz não distingue o
    // polo do pedido da constante. Só pedido de OUTRO polo prova de onde o ganho tira o polo.
    const ganhos = new EarningsService(t.db)
    await seedUser(t, { uid: 'u-compra-a' })
    await seedUser(t, { uid: 'u-compra-b' })
    const pedidoA = await seedOrder(t, { tenantId: w.a.id, userId: 'u-compra-a', status: 'paid', totalInCents: 10000 })
    await seedEnrollment(t, { userId: 'u-compra-a', courseId: w.courses.a.id, orderId: pedidoA, source: 'purchase' })
    const pedidoB = await seedOrder(t, { tenantId: w.b.id, userId: 'u-compra-b', status: 'paid', totalInCents: 10000 })
    await seedEnrollment(t, { userId: 'u-compra-b', courseId: w.courses.b.id, orderId: pedidoB, source: 'purchase' })

    await ganhos.captureForOrder(pedidoA)
    await ganhos.captureForInstallment(pedidoB, 'pay_parcela_1', 5000, 100)

    const doPedido = (orderId: string) => consulta('SELECT tenant_id, course_id, instructor_id, gross_in_cents FROM earnings WHERE order_id = ?', [orderId])
    expect(await doPedido(pedidoA)).toEqual([{ tenant_id: w.a.id, course_id: w.courses.a.id, instructor_id: w.u.teacherA, gross_in_cents: 10000 }])
    expect(await doPedido(pedidoB)).toEqual([{ tenant_id: w.b.id, course_id: w.courses.b.id, instructor_id: w.u.teacherB, gross_in_cents: 5000 }])
    // Cada polo soma o que é seu (bruto: 2000 + 10000 no A; 600 + 5000 no B) e a matriz continua com os 10000 de antes.
    const bruto = async (host: string, uid: string) => (await app.http().get('/api/admin/finance').set(como(host, uid))).body.grossInCents
    expect(await bruto(w.a.host, w.u.adminA)).toBe(12000)
    expect(await bruto(w.b.host, w.u.adminB)).toBe(5600)
    expect(await bruto(w.matriz.host, w.u.adminMatriz)).toBe(10000)
  })
})
