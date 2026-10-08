import { bootTestApp, type TestApp } from './helpers/app'
import { createTestDatabase, type TestDatabase } from './helpers/db'
import { bearer, seedOrder, seedTwoPolos, type TwoPolos } from './helpers/seed'
import { eventually } from './helpers/wait'

interface LinhaCurso {
  id: string
  title: string
  status: string
  approvedAt: string | null
  reviewNote: string | null
  instructorId: string | null
  instructorName: string | null
}

describe('painel do admin do polo', () => {
  let t: TestDatabase
  let app: TestApp
  let w: TwoPolos

  beforeAll(async () => {
    t = await createTestDatabase()
    app = await bootTestApp(t.url)
    w = await seedTwoPolos(t)
  })
  afterAll(async () => {
    try {
      await app?.close()
    } finally {
      await t?.drop()
    }
  })

  const comoAdminA = () => ({ Host: w.a.host, Authorization: bearer(w.u.adminA) })
  const como = (host: string, uid: string) => ({ Host: host, Authorization: bearer(uid) })

  const cursosDe = async (headers: Record<string, string>): Promise<LinhaCurso[]> => {
    const r = await app.http().get('/api/admin/courses').set(headers)
    expect(r.status).toBe(200)
    return r.body.courses as LinhaCurso[]
  }
  const donoDe = async (courseId: string): Promise<string | null> => {
    const [rows] = await t.pool.query('SELECT instructor_id FROM courses WHERE id = ?', [courseId])
    return (rows as Array<{ instructor_id: string | null }>)[0].instructor_id
  }

  it('as estatísticas são do polo', async () => {
    const r = await app.http().get('/api/admin/stats').set(comoAdminA())
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ studentCount: 2, teacherCount: 1, courseCount: 2, publishedCourseCount: 1 })
  })

  it('a lista de cursos é do polo e traz a aprovação', async () => {
    const r = await app.http().get('/api/admin/courses').set(comoAdminA())
    const titulos = (r.body.courses as Array<{ title: string; approvedAt: string | null }>).map((c) => [c.title, c.approvedAt !== null])
    expect(titulos.sort()).toEqual([['Excel do Polo A', true], ['Rascunho do Polo A', false]])
  })

  it('dono de outro polo é recusado e curso de outro polo é 404', async () => {
    expect((await app.http().patch(`/api/admin/courses/${w.courses.a.id}/owner`).set(comoAdminA()).send({ instructorId: w.u.teacherB })).status).toBe(404)
    expect((await app.http().patch(`/api/admin/courses/${w.courses.b.id}/owner`).set(comoAdminA()).send({ instructorId: w.u.teacherA })).status).toBe(404)
    expect((await app.http().patch(`/api/admin/courses/${w.courses.a.id}/owner`).set(comoAdminA()).send({ instructorId: w.u.teacherA })).status).toBe(200)
  })

  // Os três testes de cima são os do enunciado e dependem do estado semeado. Os de baixo gravam
  // por cima (pedidos, nota do Studio Pilari, dono do curso A, que volta ao professor no fim).

  it('cada polo, e a matriz, vê só os próprios membros e cursos', async () => {
    const b = await app.http().get('/api/admin/stats').set(como(w.b.host, w.u.adminB))
    expect(b.body).toMatchObject({ studentCount: 2, teacherCount: 1, courseCount: 1, publishedCourseCount: 1 })
    const m = await app.http().get('/api/admin/stats').set(como(w.matriz.host, w.u.adminMatriz))
    expect(m.body).toMatchObject({ studentCount: 0, teacherCount: 0, courseCount: 1, publishedCourseCount: 1 })
  })

  it('pedidos pagos e receita contam só os pedidos do polo, também os do aluno que estuda em dois polos', async () => {
    await seedOrder(t, { tenantId: w.a.id, userId: w.u.studentA, status: 'paid', totalInCents: 10000 })
    await seedOrder(t, { tenantId: w.a.id, userId: w.u.shared, status: 'paid', totalInCents: 5000 })
    await seedOrder(t, { tenantId: w.a.id, userId: w.u.studentA, status: 'pending', totalInCents: 7000 })
    await seedOrder(t, { tenantId: w.b.id, userId: w.u.shared, status: 'paid', totalInCents: 30000 })
    await seedOrder(t, { tenantId: w.matriz.id, userId: w.u.shared, status: 'paid', totalInCents: 40000 })
    const a = await app.http().get('/api/admin/stats').set(comoAdminA())
    expect(a.body).toMatchObject({ paidOrderCount: 2, grossInCents: 15000 })
    const b = await app.http().get('/api/admin/stats').set(como(w.b.host, w.u.adminB))
    expect(b.body).toMatchObject({ paidOrderCount: 1, grossInCents: 30000 })
    const m = await app.http().get('/api/admin/stats').set(como(w.matriz.host, w.u.adminMatriz))
    expect(m.body).toMatchObject({ paidOrderCount: 1, grossInCents: 40000 })
  })

  it('o admin de cada polo vê na lista só os cursos do próprio polo', async () => {
    expect((await cursosDe(como(w.b.host, w.u.adminB))).map((c) => c.title)).toEqual(['Excel do Polo B'])
    expect((await cursosDe(como(w.matriz.host, w.u.adminMatriz))).map((c) => c.title)).toEqual(['Excel da Matriz'])
  })

  it('a lista traz a nota do Studio Pilari, a aprovação em ISO e o dono do curso', async () => {
    await t.pool.query('UPDATE courses SET review_note = ? WHERE id = ?', ['Ajustar a ementa antes de publicar.', w.courses.aDraft.id])
    const lista = await cursosDe(comoAdminA())
    const publicado = lista.find((c) => c.id === w.courses.a.id)
    const rascunho = lista.find((c) => c.id === w.courses.aDraft.id)
    expect(publicado).toMatchObject({ status: 'published', reviewNote: null, instructorId: w.u.teacherA, instructorName: `Usuário ${w.u.teacherA}` })
    expect(publicado?.approvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(rascunho).toMatchObject({ status: 'draft', approvedAt: null, reviewNote: 'Ajustar a ementa antes de publicar.' })
  })

  it('pedido recusado nunca muda o dono de curso nenhum', async () => {
    const recusas = [
      { curso: w.courses.a.id, dono: w.u.teacherB, status: 404, mensagem: 'Usuário não encontrado neste polo.' }, // professor de outro polo
      { curso: w.courses.a.id, dono: 'u-que-nao-existe', status: 404, mensagem: 'Usuário não encontrado neste polo.' },
      { curso: w.courses.a.id, dono: w.u.studentA, status: 400, mensagem: 'O dono precisa ser professor ou admin deste polo.' }, // aluno do polo
      { curso: w.courses.a.id, dono: w.u.shared, status: 400, mensagem: 'O dono precisa ser professor ou admin deste polo.' }, // aluno que também é do B
      { curso: w.courses.b.id, dono: w.u.teacherA, status: 404, mensagem: 'Curso não encontrado.' }, // curso de outro polo
      { curso: w.courses.b.id, dono: w.u.teacherB, status: 404, mensagem: 'Usuário não encontrado neste polo.' }, // o par inteiro é do B
    ]
    for (const r of recusas) {
      const res = await app.http().patch(`/api/admin/courses/${r.curso}/owner`).set(comoAdminA()).send({ instructorId: r.dono })
      expect([res.status, res.body.message]).toEqual([r.status, r.mensagem])
    }
    expect(await donoDe(w.courses.a.id)).toBe(w.u.teacherA)
    expect(await donoDe(w.courses.b.id)).toBe(w.u.teacherB)
    // o curso do B segue com o dono dele na lista do B
    expect((await cursosDe(como(w.b.host, w.u.adminB)))[0]).toMatchObject({ instructorId: w.u.teacherB })
  })

  it('o dono pode ser um admin do polo: o curso muda de dono, a lista mostra e a ação fica no log do polo', async () => {
    const r = await app.http().patch(`/api/admin/courses/${w.courses.a.id}/owner`).set(comoAdminA()).send({ instructorId: w.u.adminA })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ instructorId: w.u.adminA, instructorName: `Usuário ${w.u.adminA}` })
    expect(await donoDe(w.courses.a.id)).toBe(w.u.adminA)
    expect((await cursosDe(comoAdminA())).find((c) => c.id === w.courses.a.id)).toMatchObject({ instructorId: w.u.adminA })
    const logs = await eventually(
      async () => (await t.pool.query("SELECT tenant_id, target_id, actor_uid FROM audit_logs WHERE action = 'course.owner'"))[0] as Array<{ tenant_id: string; target_id: string; actor_uid: string }>,
      (v) => v.length > 0
    )
    expect(logs).toContainEqual({ tenant_id: w.a.id, target_id: w.courses.a.id, actor_uid: w.u.adminA })
    // devolve o curso ao professor, para não depender da ordem dos testes
    expect((await app.http().patch(`/api/admin/courses/${w.courses.a.id}/owner`).set(comoAdminA()).send({ instructorId: w.u.teacherA })).status).toBe(200)
    expect(await donoDe(w.courses.a.id)).toBe(w.u.teacherA)
  })

  it('só o admin do polo do endereço entra no painel', async () => {
    const quem = [como(w.a.host, w.u.adminB), como(w.a.host, w.u.teacherA), como(w.a.host, w.u.studentA), como(w.a.host, w.u.shared)]
    for (const headers of quem) {
      expect((await app.http().get('/api/admin/stats').set(headers)).status).toBe(403)
      expect((await app.http().get('/api/admin/courses').set(headers)).status).toBe(403)
      expect((await app.http().patch(`/api/admin/courses/${w.courses.a.id}/owner`).set(headers).send({ instructorId: w.u.teacherA })).status).toBe(403)
    }
  })
})
