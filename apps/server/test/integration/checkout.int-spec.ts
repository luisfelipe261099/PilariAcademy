import { bootTestApp, type TestApp } from './helpers/app'
import { createTestDatabase, type TestDatabase } from './helpers/db'
import { bearer, seedCoupon, seedEnrollment, seedOrder, seedUser, seedTwoPolos, type TwoPolos } from './helpers/seed'

describe('carrinho, cupons e checkout por polo', () => {
  let t: TestDatabase
  let app: TestApp
  let w: TwoPolos
  let cupomMatriz: string

  beforeAll(async () => {
    t = await createTestDatabase()
    app = await bootTestApp(t.url)
    w = await seedTwoPolos(t)
    cupomMatriz = await seedCoupon(t, { tenantId: w.matriz.id, code: 'BEMVINDO', value: 10 })
    await seedCoupon(t, { tenantId: w.a.id, code: 'BEMVINDO', value: 50 })
    await seedCoupon(t, { tenantId: w.matriz.id, code: 'GRATIS', value: 100 })
    await seedUser(t, { uid: 'u-comprador' })
  })
  afterAll(async () => {
    try {
      await app?.close()
    } finally {
      await t?.drop()
    }
  })

  it('o resumo do carrinho ignora curso de outro polo', async () => {
    const r = await app.http().post('/api/cart/summary').set('Host', w.a.host).send({ courseIds: [w.courses.a.id, w.courses.b.id] })
    expect((r.body.items as Array<{ id: string }>).map((i) => i.id)).toEqual([w.courses.a.id])
  })

  it('o mesmo código de cupom vale o desconto do polo do endereço', async () => {
    const m = await app.http().post('/api/cart/summary').set('Host', w.matriz.host).send({ courseIds: [w.courses.matriz.id], couponCode: 'BEMVINDO' })
    const a = await app.http().post('/api/cart/summary').set('Host', w.a.host).send({ courseIds: [w.courses.a.id], couponCode: 'BEMVINDO' })
    expect(m.body.discountInCents).toBe(1000)
    expect(a.body.discountInCents).toBe(5000)
  })

  it('polo sem venda recusa o checkout', async () => {
    const r = await app.http().post('/api/checkout').set('Host', w.a.host).set('Authorization', bearer(w.u.studentA)).send({ courseIds: [w.courses.a.id] })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('TENANT_SALES_DISABLED')
    // Na loja, a mensagem continua a do aluno (a do painel é outra, B5).
    expect(r.body.message).toBe('As matrículas pelo site deste polo ainda estão em configuração. Fale com o polo para se matricular.')
  })

  it('a matriz recusa curso de polo no carrinho', async () => {
    const r = await app.http().post('/api/checkout').set('Host', w.matriz.host).set('Authorization', bearer('u-comprador')).send({ courseIds: [w.courses.a.id] })
    expect(r.status).toBe(400)
  })

  it('compra gratuita na matriz grava matrícula e resgate com o polo', async () => {
    const r = await app.http().post('/api/checkout').set('Host', w.matriz.host).set('Authorization', bearer('u-comprador'))
      .send({ courseIds: [w.courses.matriz.id], couponCode: 'GRATIS' })
    expect(r.status).toBe(201)
    const [res] = await t.pool.query('SELECT tenant_id FROM coupon_redemptions WHERE user_id = ?', ['u-comprador'])
    expect(res).toEqual([{ tenant_id: w.matriz.id }])
  })

  describe('B3: comprar garante o vínculo de aluno', () => {
    const vinculo = async (tenantId: string, uid: string) => (await t.pool.query('SELECT roles FROM tenant_members WHERE tenant_id = ? AND user_uid = ?', [tenantId, uid]))[0]

    it('o comprador sem vínculo que comprou grátis na matriz aparece nos usuários da matriz', async () => {
      const r = await app.http().get('/api/admin/users/u-comprador').set('Host', w.matriz.host).set('Authorization', bearer(w.u.adminMatriz))
      expect([r.status, r.body.user?.roles]).toEqual([200, ['student']])
    })

    it('a compra paga também vincula, já no pedido; a plataforma que compra não vira aluna', async () => {
      await seedUser(t, { uid: 'u-comprador-pago' })
      const pago = await app.http().post('/api/checkout').set('Host', w.matriz.host).set('Authorization', bearer('u-comprador-pago'))
        .send({ courseIds: [w.courses.matriz.id], cpf: '529.982.247-25' })
      expect([pago.status, typeof pago.body.paymentUrl]).toEqual([201, 'string'])
      expect(await vinculo(w.matriz.id, 'u-comprador-pago')).toEqual([{ roles: ['student'] }])
      const plataforma = await app.http().post('/api/checkout').set('Host', w.matriz.host).set('Authorization', bearer(w.u.platform))
        .send({ courseIds: [w.courses.matriz.id], couponCode: 'GRATIS' })
      expect(plataforma.status).toBe(201)
      expect((await t.pool.query('SELECT tenant_id FROM tenant_members WHERE user_uid = ?', [w.u.platform]))[0]).toEqual([])
    })

    it('a liberação do pedido (aqui, a baixa manual) vincula o comprador', async () => {
      await seedUser(t, { uid: 'u-boleto' })
      const pedido = await seedOrder(t, { tenantId: w.matriz.id, userId: 'u-boleto', status: 'pending' })
      await seedEnrollment(t, { userId: 'u-boleto', courseId: w.courses.matriz.id, status: 'pending', source: 'purchase', orderId: pedido })
      expect(await vinculo(w.matriz.id, 'u-boleto')).toEqual([])
      const r = await app.http().post(`/api/admin/orders/${pedido}/settle`).set('Host', w.matriz.host).set('Authorization', bearer(w.u.platform))
      expect([r.status, r.body]).toEqual([201, { alreadyPaid: false }])
      expect(await vinculo(w.matriz.id, 'u-boleto')).toEqual([{ roles: ['student'] }])
      expect((await t.pool.query('SELECT status FROM enrollments WHERE order_id = ?', [pedido]))[0]).toEqual([{ status: 'active' }])
    })
  })

  it('o admin do polo gerencia só os cupons do polo', async () => {
    const auth = { Host: w.a.host, Authorization: bearer(w.u.adminA) }
    const lista = await app.http().get('/api/admin/coupons').set(auth)
    expect((lista.body.coupons as Array<{ code: string }>).map((c) => c.code)).toEqual(['BEMVINDO'])
    expect((await app.http().patch(`/api/admin/coupons/${cupomMatriz}`).set(auth).send({ active: false })).status).toBe(404)
    expect((await app.http().post('/api/admin/coupons').set(auth).send({ code: 'BEMVINDO', type: 'percent', value: 5 })).status).toBe(409)
  })
})
