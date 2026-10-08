import { randomUUID } from 'node:crypto'
import { lessons } from '../../src/db/schema'
import { PlatformReviewService } from '../../src/modules/platform/platform-review.service'
import { bootTestApp, type TestApp } from './helpers/app'
import { createTestDatabase, type TestDatabase } from './helpers/db'
import { bearer, seedCourse, seedTwoPolos, type TwoPolos } from './helpers/seed'
import { eventually } from './helpers/wait'

describe('console da plataforma: aprovação de cursos', () => {
  let t: TestDatabase
  let app: TestApp
  let w: TwoPolos
  let seq = 0

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

  const plataforma = () => ({ Host: w.matriz.host, Authorization: bearer(w.u.platform) })
  const profA = () => ({ Host: w.a.host, Authorization: bearer(w.u.teacherA) })
  const adminA = () => ({ Host: w.a.host, Authorization: bearer(w.u.adminA) })
  const adminB = () => ({ Host: w.b.host, Authorization: bearer(w.u.adminB) })
  const status = (id: string, s: string, quem: Record<string, string>) => app.http().patch(`/api/instructor/courses/${id}/status`).set(quem).send({ status: s })
  const fila = async () => (await app.http().get('/api/platform/review-queue').set(plataforma())).body.items as Array<Record<string, unknown>>
  const decidir = (acao: 'approve' | 'return' | 'takedown', id: string, body?: object) => {
    const req = app.http().post(`/api/platform/courses/${id}/${acao}`).set(plataforma())
    return body ? req.send(body) : req
  }
  const itemDaFila = async (id: string) => (await fila()).find((i) => i.courseId === id)
  /** Aprova como o console: com o fingerprint que a fila mostrou para o curso. */
  const aprovar = async (id: string) => decidir('approve', id, { fingerprint: (await itemDaFila(id))?.fingerprint })
  const logsDoPolo = async (quem: Record<string, string>) =>
    (await app.http().get('/api/admin/logs').set(quem)).body.logs as Array<{ id: string; action: string; targetId: string | null }>
  const linha = async (courseId: string, colunas: string): Promise<Record<string, unknown>> => {
    const [rows] = await t.pool.query(`SELECT ${colunas} FROM courses WHERE id = ?`, [courseId])
    return (rows as Array<Record<string, unknown>>)[0]
  }
  /**
   * Curso novo em análise, só para um teste: o estado dele não vaza para os outros. Cada teste que cria um resolve o seu
   * (aprova ou devolve) para deixar a fila vazia: o teste da ordem da fila confere a fila inteira.
   */
  const cursoEmAnalise = async (input: { tenantId: string; instructorId: string; workloadHours?: number | null; aulasSec?: number[]; submittedAt?: Date }) => {
    seq += 1
    const c = await seedCourse(t, {
      tenantId: input.tenantId, slug: `analise-${seq}`, title: `Curso em Análise ${seq}`, instructorId: input.instructorId,
      status: 'in_review', workloadHours: input.workloadHours ?? null,
    })
    const [primeira, ...demais] = input.aulasSec ?? [600]
    await t.pool.query('UPDATE lessons SET duration_sec = ? WHERE id = ?', [primeira, c.lessonId])
    for (const [i, durationSec] of demais.entries()) {
      await t.db.insert(lessons).values({ id: randomUUID(), moduleId: c.moduleId, title: `Aula ${i + 2}`, durationSec, order: i + 1, isFreePreview: false })
    }
    if (input.submittedAt) await t.pool.query('UPDATE courses SET submitted_at = ? WHERE id = ?', [input.submittedAt, c.id])
    return c
  }

  // Os testes dependem da ordem: o ciclo do primeiro deixa o curso do polo A aprovado e depois tirado do ar, e os dois
  // seguintes leem o log que ele gerou. Os demais criam o próprio curso e deixam a fila vazia.

  it('o ciclo envio → devolução → reenvio → aprovação → trava → retirada', async () => {
    const id = w.courses.aDraft.id

    expect((await status(id, 'in_review', profA())).status).toBe(200)
    const [item] = await fila()
    expect(item).toMatchObject({
      courseId: id, tenantName: 'Polo A', lessonCount: 1, moduleCount: 1, instructorName: 'Usuário u-prof-a',
      editorUrl: `https://polo-a.cursos.studiopilari.com.br/instrutor/curso/${id}`,
    })
    expect(typeof item.submittedAt).toBe('string')

    expect((await app.http().post(`/api/platform/courses/${id}/return`).set(plataforma()).send({ note: '' })).status).toBe(400)
    expect((await app.http().post(`/api/platform/courses/${id}/return`).set(plataforma()).send({ note: 'A aula 1 está sem áudio.' })).status).toBe(201)
    const devolvido = await app.http().get(`/api/instructor/courses/${id}/meta`).set(profA())
    expect(devolvido.body.course).toMatchObject({ status: 'draft', reviewNote: 'A aula 1 está sem áudio.' })
    expect(await fila()).toEqual([])

    expect((await status(id, 'in_review', profA())).status).toBe(200)
    expect((await status(id, 'published', adminA())).body.code).toBe('APPROVAL_REQUIRED')
    expect((await app.http().post(`/api/platform/courses/${id}/approve`).set('Host', w.a.host).set('Authorization', bearer(w.u.adminA))).status).toBe(403)
    expect((await aprovar(id)).status).toBe(201)

    const catalogo = await app.http().get('/api/courses').set('Host', w.a.host)
    expect(JSON.stringify(catalogo.body)).toContain('rascunho-a')
    const travado = await app.http().patch(`/api/instructor/courses/${id}`).set(adminA()).send({ title: 'Outro título' })
    expect(travado.status).toBe(403)
    expect(travado.body.code).toBe('CERTIFICATE_FIELDS_LOCKED')
    expect((await app.http().patch(`/api/instructor/courses/${id}`).set(adminA()).send({ priceInCents: 4990 })).status).toBe(200)

    expect((await decidir('approve', id, { fingerprint: 'qualquer' })).body.code).toBe('INVALID_TRANSITION')
    expect((await app.http().post(`/api/platform/courses/${id}/takedown`).set(plataforma()).send({ note: 'Vídeo com direitos autorais.' })).status).toBe(201)
    const fora = await status(id, 'published', adminA())
    expect(fora.status).toBe(403)
    expect(fora.body.message).toContain('O Studio Pilari pediu ajustes')
  })

  it('os logs da plataforma mostram o polo de cada decisão', async () => {
    const id = w.courses.aDraft.id
    const logs = await eventually(
      async () => (await app.http().get('/api/platform/logs').set(plataforma())).body.logs as Array<{ action: string; targetId: string | null; tenantName: string | null }>,
      (l) => l.some((x) => x.action === 'course.takedown')
    )
    expect(logs.find((x) => x.action === 'course.approve' && x.targetId === id)).toMatchObject({ tenantId: w.a.id, tenantName: 'Polo A' })
    const decisoes = ['course.approve', 'course.return', 'course.takedown']
    expect(logs.filter((x) => x.targetId === id && decisoes.includes(x.action)).map((x) => [x.action, x.tenantName]).sort()).toEqual([
      ['course.approve', 'Polo A'], ['course.return', 'Polo A'], ['course.takedown', 'Polo A'],
    ])
  })

  it('o admin do polo vê no log do polo as decisões do Studio Pilari, atribuídas a quem decidiu; o outro polo não vê', async () => {
    const id = w.courses.aDraft.id
    const logs = await eventually(() => logsDoPolo(adminA()), (l) => l.some((x) => x.action === 'course.approve'))
    expect(logs.map((x) => x.action)).toEqual(expect.arrayContaining(['course.approve', 'course.return', 'course.takedown']))
    // A decisão é da plataforma, mas o log pertence ao polo do CURSO: nada fica sem polo nem cai na matriz.
    const [rows] = await t.pool.query(
      "SELECT action, tenant_id, actor_uid FROM audit_logs WHERE target_id = ? AND action IN ('course.approve', 'course.return', 'course.takedown') ORDER BY action",
      [id]
    )
    expect(rows).toEqual([
      { action: 'course.approve', tenant_id: w.a.id, actor_uid: w.u.platform },
      { action: 'course.return', tenant_id: w.a.id, actor_uid: w.u.platform },
      { action: 'course.takedown', tenant_id: w.a.id, actor_uid: w.u.platform },
    ])
    // O admin do polo B não enxerga decisão sobre curso do polo A.
    expect((await logsDoPolo(adminB())).some((x) => x.targetId === id)).toBe(false)
  })

  it('ação da plataforma, sem polo, aparece nos logs da rede com tenantName null', async () => {
    const id = randomUUID()
    await t.pool.query(
      "INSERT INTO audit_logs (id, tenant_id, actor_email, action, summary, created_at) VALUES (?, NULL, 'plataforma@studiopilari.com.br', 'tenant.create', 'Criou o polo Novo (novo)', NOW(3))",
      [id]
    )
    const logs = (await app.http().get('/api/platform/logs').set(plataforma())).body.logs as Array<{ id: string; tenantName: string | null }>
    expect(logs.find((x) => x.id === id)).toMatchObject({ action: 'tenant.create', tenantId: null, tenantName: null })
    // E nenhum polo enxerga o log da plataforma.
    expect((await logsDoPolo(adminA())).some((x) => x.id === id)).toBe(false)
  })

  it('a primeira aprovação congela a carga calculada, e a fila já mostra esse número', async () => {
    // 7200 s + 5760 s = 3,6 h, arredondado para 4: sem carga definida, é o que o certificado vai imprimir.
    const c = await cursoEmAnalise({ tenantId: w.a.id, instructorId: w.u.teacherA, aulasSec: [7200, 5760] })
    expect(await linha(c.id, 'workload_hours')).toEqual({ workload_hours: null })

    const item = (await fila()).find((i) => i.courseId === c.id)
    expect(item).toMatchObject({ lessonCount: 2, workloadHours: 4, workloadIsComputed: true })

    expect((await aprovar(c.id)).status).toBe(201)
    expect(await linha(c.id, 'status, workload_hours, approved_by')).toEqual({ status: 'published', workload_hours: 4, approved_by: w.u.platform })

    // As aulas seguem editáveis depois da aprovação, mas o número impresso não muda com elas.
    await t.pool.query('UPDATE lessons SET duration_sec = 360000 WHERE id = ?', [c.lessonId])
    expect(await linha(c.id, 'workload_hours')).toEqual({ workload_hours: 4 })
    const meta = await app.http().get(`/api/instructor/courses/${c.id}/meta`).set(adminA())
    expect(meta.body.course).toMatchObject({ workloadHours: 4, certificateFieldsLocked: true })
    // E o número gravado já está sob a trava dos dados do certificado.
    const mudar = await app.http().patch(`/api/instructor/courses/${c.id}`).set(adminA()).send({ workloadHours: 360 })
    expect(mudar.status).toBe(403)
    expect(mudar.body.code).toBe('CERTIFICATE_FIELDS_LOCKED')
  })

  it('a carga definida pelo polo vence a soma: a fila a mostra como definida e a aprovação não a troca', async () => {
    const c = await cursoEmAnalise({ tenantId: w.a.id, instructorId: w.u.teacherA, workloadHours: 180, aulasSec: [7200] })
    expect((await fila()).find((i) => i.courseId === c.id)).toMatchObject({ workloadHours: 180, workloadIsComputed: false })
    expect((await aprovar(c.id)).status).toBe(201)
    expect(await linha(c.id, 'workload_hours')).toEqual({ workload_hours: 180 })
  })

  it('só a primeira aprovação congela: curso já aprovado, tirado do ar e reenviado não tem a carga refeita', async () => {
    const c = await cursoEmAnalise({ tenantId: w.a.id, instructorId: w.u.teacherA, aulasSec: [7200] })
    expect((await aprovar(c.id)).status).toBe(201)
    expect(await linha(c.id, 'workload_hours')).toEqual({ workload_hours: 2 })
    const primeira = await linha(c.id, 'approved_at, approved_by')

    expect((await decidir('takedown', c.id, { note: 'Ajustar a ementa.' })).status).toBe(201)
    await t.pool.query('UPDATE lessons SET duration_sec = 36000 WHERE id = ?', [c.lessonId])
    expect((await status(c.id, 'in_review', profA())).status).toBe(200)
    expect((await fila()).find((i) => i.courseId === c.id)).toMatchObject({ workloadHours: 2, workloadIsComputed: false })
    expect((await aprovar(c.id)).status).toBe(201)

    expect(await linha(c.id, 'workload_hours')).toEqual({ workload_hours: 2 })
    expect(await linha(c.id, 'approved_at, approved_by')).toEqual(primeira)
    // aprovar de novo apagou a nota da retirada
    expect(await linha(c.id, 'status, review_note')).toEqual({ status: 'published', review_note: null })
  })

  it('curso legado (aprovado pela migration, sem autor e sem carga): tirado do ar e reaprovado mantém a data, não ganha autor nem carga', async () => {
    const matrizAdmin = { Host: w.matriz.host, Authorization: bearer(w.u.adminMatriz) }
    const legado = await seedCourse(t, { tenantId: w.matriz.id, slug: 'legado-matriz', title: 'Curso Legado', instructorId: w.u.adminMatriz })
    const antes = await linha(legado.id, 'approved_at, approved_by, published_at, workload_hours')
    expect(antes).toMatchObject({ approved_by: null, workload_hours: null })
    expect(antes.approved_at).toBeInstanceOf(Date)

    expect((await decidir('takedown', legado.id, { note: 'Rever a ementa.' })).status).toBe(201)
    expect((await status(legado.id, 'in_review', matrizAdmin)).status).toBe(200)
    expect((await fila()).find((i) => i.courseId === legado.id)).toMatchObject({ tenantSlug: 'pilari', workloadHours: 1, workloadIsComputed: true })
    expect((await aprovar(legado.id)).status).toBe(201)

    // Só a PRIMEIRA aprovação grava o par data e autor e congela a carga: este curso já tinha sido aprovado.
    expect(await linha(legado.id, 'status, review_note, approved_at, approved_by, published_at, workload_hours')).toEqual({
      status: 'published', review_note: null, approved_at: antes.approved_at, approved_by: null, published_at: antes.published_at, workload_hours: null,
    })
  })

  it('curso sem aulas ou sem módulos aparece na fila com a carga mínima de 1 hora', async () => {
    const semAula = await cursoEmAnalise({ tenantId: w.a.id, instructorId: w.u.teacherA })
    await t.pool.query('DELETE FROM lessons WHERE id = ?', [semAula.lessonId])
    const semModulo = await cursoEmAnalise({ tenantId: w.a.id, instructorId: w.u.teacherA })
    await t.pool.query('DELETE FROM lessons WHERE id = ?', [semModulo.lessonId])
    await t.pool.query('DELETE FROM modules WHERE id = ?', [semModulo.moduleId])

    const itens = await fila()
    expect(itens.find((i) => i.courseId === semAula.id)).toMatchObject({ moduleCount: 1, lessonCount: 0, workloadHours: 1, workloadIsComputed: true })
    expect(itens.find((i) => i.courseId === semModulo.id)).toMatchObject({ moduleCount: 0, lessonCount: 0, workloadHours: 1, workloadIsComputed: true })
    expect((await decidir('return', semAula.id, { note: 'Curso sem aulas.' })).status).toBe(201)
    expect((await decidir('return', semModulo.id, { note: 'Curso sem módulos.' })).status).toBe(201)
    expect(await fila()).toEqual([])
  })

  it('a fila reúne os cursos de todos os polos, do envio mais antigo para o mais novo; cada decisão vai para o log do polo do curso', async () => {
    const b = await cursoEmAnalise({ tenantId: w.b.id, instructorId: w.u.teacherB, submittedAt: new Date('2026-01-02T10:00:00Z') })
    const m = await cursoEmAnalise({ tenantId: w.matriz.id, instructorId: w.u.adminMatriz, submittedAt: new Date('2026-01-01T10:00:00Z') })
    const a = await cursoEmAnalise({ tenantId: w.a.id, instructorId: w.u.teacherA, submittedAt: new Date('2026-01-03T10:00:00Z') })

    const itens = await fila()
    expect(itens.map((i) => i.courseId)).toEqual([m.id, b.id, a.id])
    expect(itens).toMatchObject([
      { tenantId: w.matriz.id, tenantSlug: 'pilari', instructorName: 'Usuário u-adm-m', editorUrl: `https://cursos.studiopilari.com.br/instrutor/curso/${m.id}` },
      { tenantId: w.b.id, tenantSlug: 'polo-b', tenantName: 'Polo B', instructorName: 'Usuário u-prof-b', editorUrl: `https://polo-b.cursos.studiopilari.com.br/instrutor/curso/${b.id}` },
      { tenantId: w.a.id, tenantSlug: 'polo-a', tenantName: 'Polo A', instructorName: 'Usuário u-prof-a', editorUrl: `https://polo-a.cursos.studiopilari.com.br/instrutor/curso/${a.id}` },
    ])

    for (const c of [m, b, a]) expect((await decidir('return', c.id, { note: 'Faltou a ementa.' })).status).toBe(201)
    expect(await fila()).toEqual([])

    // O log de cada decisão pertence ao polo do curso: o admin do B vê a do B e não vê a do A, e o inverso.
    const logsB = await eventually(() => logsDoPolo(adminB()), (l) => l.some((x) => x.targetId === b.id))
    expect(logsB.filter((x) => x.targetId === b.id).map((x) => x.action)).toEqual(['course.return'])
    expect(logsB.some((x) => x.targetId === a.id || x.targetId === m.id)).toBe(false)
    const logsA = await eventually(() => logsDoPolo(adminA()), (l) => l.some((x) => x.targetId === a.id))
    expect(logsA.some((x) => x.targetId === b.id || x.targetId === m.id)).toBe(false)
    // O log é gravado em segundo plano: espera os três (o da matriz inclusive) antes de conferir.
    const rede = await eventually(
      async () => (await app.http().get('/api/platform/logs').set(plataforma())).body.logs as Array<{ action: string; targetId: string | null; tenantName: string | null }>,
      (l) => [m.id, b.id, a.id].every((id) => l.some((x) => x.targetId === id && x.action === 'course.return'))
    )
    expect(rede.find((x) => x.targetId === b.id && x.action === 'course.return')).toMatchObject({ tenantName: 'Polo B' })
    expect(rede.find((x) => x.targetId === a.id && x.action === 'course.return')).toMatchObject({ tenantName: 'Polo A' })
    expect(rede.find((x) => x.targetId === m.id && x.action === 'course.return')?.tenantName).toBeTruthy()
  })

  it('só a plataforma (inclusive o admin da matriz) abre a fila, decide e lê os logs da rede; nada é gravado para quem não é', async () => {
    expect((await app.http().get('/api/platform/review-queue').set({ Host: w.matriz.host, Authorization: bearer(w.u.adminMatriz) })).status).toBe(200)
    const alvo = w.courses.a.id // publicado: se a trava falhasse, o takedown abaixo tiraria o curso do ar
    const quem: Array<[string, Record<string, string>]> = [
      ['admin do polo A', adminA()],
      ['professor do polo A', profA()],
      ['aluno do polo A', { Host: w.a.host, Authorization: bearer(w.u.studentA) }],
    ]
    for (const [, cabecalho] of quem) {
      expect((await app.http().get('/api/platform/review-queue').set(cabecalho)).status).toBe(403)
      expect((await app.http().get('/api/platform/logs').set(cabecalho)).status).toBe(403)
      expect((await app.http().post(`/api/platform/courses/${alvo}/approve`).set(cabecalho)).status).toBe(403)
      expect((await app.http().post(`/api/platform/courses/${alvo}/return`).set(cabecalho).send({ note: 'Teste de acesso.' })).status).toBe(403)
      expect((await app.http().post(`/api/platform/courses/${alvo}/takedown`).set(cabecalho).send({ note: 'Teste de acesso.' })).status).toBe(403)
    }
    // sem login
    expect((await app.http().get('/api/platform/review-queue').set('Host', w.matriz.host)).status).toBe(401)
    expect((await app.http().get('/api/platform/logs').set('Host', w.matriz.host)).status).toBe(401)
    expect((await app.http().post(`/api/platform/courses/${alvo}/takedown`).set('Host', w.matriz.host).send({ note: 'Teste de acesso.' })).status).toBe(401)
    expect(await linha(alvo, 'status, review_note')).toEqual({ status: 'published', review_note: null })
  })

  it('recusas: motivo ausente ou fora do tamanho, status errado e curso inexistente; nada é gravado', async () => {
    const c = await cursoEmAnalise({ tenantId: w.a.id, instructorId: w.u.teacherA })
    const antes = await linha(c.id, 'status, review_note, updated_at')

    const semCorpo = await decidir('return', c.id, {})
    expect(semCorpo.status).toBe(400)
    const longo = await decidir('return', c.id, { note: 'a'.repeat(1001) })
    expect(longo.status).toBe(400)
    expect(longo.body.message).toBe('Escreva o motivo (3 a 1000 caracteres).')
    expect((await decidir('return', c.id, { note: 'ab' })).status).toBe(400)
    expect((await decidir('return', c.id, { note: 'Aula 1 sem áudio.', status: 'published' })).status).toBe(400)

    // só curso publicado sai do ar; só curso em análise é devolvido ou aprovado
    const tirar = await decidir('takedown', c.id, { note: 'Direitos autorais.' })
    expect(tirar.status).toBe(400)
    expect(tirar.body).toMatchObject({ code: 'INVALID_TRANSITION', message: 'Só um curso publicado pode ser tirado do ar.' })
    const publicado = w.courses.b.id
    const devolver = await decidir('return', publicado, { note: 'Aula 1 sem áudio.' })
    expect(devolver.body).toMatchObject({ code: 'INVALID_TRANSITION', message: 'Só um curso em análise pode ser devolvido.' })
    const aprovado = await decidir('approve', publicado, { fingerprint: 'qualquer' })
    expect(aprovado.body).toMatchObject({ code: 'INVALID_TRANSITION', message: 'Só um curso em análise pode ser aprovado.' })
    // sem o fingerprint da fila a aprovação nem é considerada
    for (const corpo of [undefined, {}, { fingerprint: '' }, { fingerprint: null }]) {
      const semVersao = await decidir('approve', c.id, corpo)
      expect([JSON.stringify(corpo), semVersao.status, semVersao.body.message]).toEqual([
        JSON.stringify(corpo), 400, expect.arrayContaining(['Recarregue a fila de aprovação e confira o curso antes de aprovar.']),
      ])
    }

    for (const acao of ['approve', 'return', 'takedown'] as const) {
      const r = await decidir(acao, 'nao-existe', acao === 'approve' ? { fingerprint: 'qualquer' } : { note: 'Aula 1 sem áudio.' })
      expect(r.status).toBe(404)
      expect(r.body.message).toBe('Curso não encontrado.')
    }

    expect(await linha(c.id, 'status, review_note, updated_at')).toEqual(antes)
    expect(await linha(publicado, 'status, review_note')).toEqual({ status: 'published', review_note: null })
    expect((await decidir('return', c.id, { note: 'Fim do teste.' })).status).toBe(201)
    expect(await fila()).toEqual([])
  })

  describe('cursos de todos os polos (modelos de certificado)', () => {
    const cursosDaRede = (q?: string, quem: Record<string, string> = plataforma()) => {
      const req = app.http().get('/api/platform/courses').set(quem)
      return q === undefined ? req : req.query({ q })
    }

    it('a plataforma busca por título nos cursos da matriz e dos dois polos, ordenados por polo e título', async () => {
      const r = await cursosDaRede('excel')
      expect(r.status).toBe(200)
      const linhas = r.body.courses as Array<Record<string, unknown>>
      expect(linhas.map((c) => c.title)).toEqual(['Excel da Matriz', 'Excel do Polo A', 'Excel do Polo B'])
      expect(linhas[1]).toEqual({
        id: w.courses.a.id, title: 'Excel do Polo A', slug: 'excel-basico', tenantId: w.a.id, tenantName: 'Polo A', status: 'published', certificateTemplateId: null,
      })
      expect(linhas[0]).toMatchObject({ tenantId: w.matriz.id, slug: 'excel-basico' })
      expect(linhas[2]).toMatchObject({ tenantId: w.b.id, tenantName: 'Polo B' })
    })

    it('sem busca lista também rascunhos de qualquer polo; curinga do LIKE na busca é texto, não "qualquer coisa"', async () => {
      const todos = (await cursosDaRede()).body.courses as Array<{ id: string; status: string }>
      expect(todos.find((c) => c.id === w.courses.aDraft.id)).toMatchObject({ status: expect.any(String) })
      expect(todos.length).toBeGreaterThanOrEqual(4)
      expect((await cursosDaRede('%')).body.courses).toEqual([])
      expect((await cursosDaRede('_')).body.courses).toEqual([])
    })

    it('admin e professor de polo recebem 403; sem login, 401', async () => {
      for (const quem of [adminA(), profA(), adminB()]) expect((await cursosDaRede('excel', quem)).status).toBe(403)
      expect((await app.http().get('/api/platform/courses').set('Host', w.matriz.host)).status).toBe(401)
    })
  })

  describe('a aprovação trava o que a fila mostrou', () => {
    const MUDOU = { statusCode: 409, code: 'COURSE_CHANGED', message: 'O curso mudou desde que a fila foi carregada. Recarregue e confira antes de aprovar.' }

    it('a fila mostra o que o certificado vai levar: coordenador, cargo, assinatura, primeira aprovação, a nota anterior e o fingerprint', async () => {
      const c = await cursoEmAnalise({ tenantId: w.a.id, instructorId: w.u.teacherA })
      await t.pool.query(
        "UPDATE courses SET coordinator_name = 'Ana Souza', coordinator_role = 'Coordenadora', coordinator_signature_path = ?, review_note = 'Falta a ementa.' WHERE id = ?",
        [`cursos/${c.id}/signature/ana.png`, c.id]
      )
      const item = await itemDaFila(c.id)
      expect(item).toMatchObject({
        coordinatorName: 'Ana Souza', coordinatorRole: 'Coordenadora', hasCoordinatorSignature: true, firstApproval: true, reviewNote: 'Falta a ementa.',
      })
      expect(item?.fingerprint).toMatch(/^[0-9a-f]{16}$/)
      // o caminho da assinatura não vai para a fila, só se ela existe
      expect(JSON.stringify(item)).not.toContain('ana.png')

      // curso que já foi aprovado antes (reenvio depois de tirado do ar) não é primeira aprovação
      await t.pool.query('UPDATE courses SET approved_at = NOW(3), coordinator_signature_path = NULL, review_note = NULL WHERE id = ?', [c.id])
      expect(await itemDaFila(c.id)).toMatchObject({ firstApproval: false, hasCoordinatorSignature: false, reviewNote: null })
      expect((await decidir('return', c.id, { note: 'Fim do teste.' })).status).toBe(201)
    })

    it('mudou o título, o coordenador ou a duração das aulas (carga calculada) depois da fila: 409 COURSE_CHANGED e nada é gravado', async () => {
      const c = await cursoEmAnalise({ tenantId: w.a.id, instructorId: w.u.teacherA, aulasSec: [7200] })
      const mudancas: Array<[string, string, unknown[]]> = [
        ['título', 'UPDATE courses SET title = ? WHERE id = ?', ['Título Trocado', c.id]],
        ['coordenador', 'UPDATE courses SET coordinator_name = ? WHERE id = ?', ['Beto Lima', c.id]],
        ['cargo', 'UPDATE courses SET coordinator_role = ? WHERE id = ?', ['Diretor', c.id]],
        ['assinatura', 'UPDATE courses SET coordinator_signature_path = ? WHERE id = ?', [`cursos/${c.id}/signature/beto.png`, c.id]],
        ['duração das aulas', 'UPDATE lessons SET duration_sec = ? WHERE id = ?', [36000, c.lessonId]],
      ]
      for (const [oQue, sql, params] of mudancas) {
        const vista = (await itemDaFila(c.id))?.fingerprint
        await t.pool.query(sql, params)
        const r = await decidir('approve', c.id, { fingerprint: vista })
        expect([oQue, r.status, r.body]).toEqual([oQue, 409, MUDOU])
        expect(await linha(c.id, 'status, approved_at, workload_hours')).toEqual({ status: 'in_review', approved_at: null, workload_hours: null })
      }
      // recarregada a fila, a aprovação passa e congela a carga que a fila mostrou (36000 s = 10 h)
      expect(await itemDaFila(c.id)).toMatchObject({ workloadHours: 10, workloadIsComputed: true })
      expect((await aprovar(c.id)).status).toBe(201)
      expect(await linha(c.id, 'status, workload_hours')).toEqual({ status: 'published', workload_hours: 10 })
    })

    it('com a carga definida pelo polo, mexer na duração das aulas não muda o que o certificado leva e a aprovação passa', async () => {
      const c = await cursoEmAnalise({ tenantId: w.a.id, instructorId: w.u.teacherA, workloadHours: 40, aulasSec: [7200] })
      const vista = (await itemDaFila(c.id))?.fingerprint
      await t.pool.query('UPDATE lessons SET duration_sec = 36000 WHERE id = ?', [c.lessonId])
      expect((await decidir('approve', c.id, { fingerprint: vista })).status).toBe(201)
    })

    it('curso sem aula não é aprovado: 400 com a mesma mensagem e o mesmo código do envio para análise', async () => {
      const c = await cursoEmAnalise({ tenantId: w.a.id, instructorId: w.u.teacherA })
      await t.pool.query('DELETE FROM lessons WHERE id = ?', [c.lessonId])
      const r = await aprovar(c.id)
      expect([r.status, r.body.code, r.body.message]).toEqual([400, 'COURSE_WITHOUT_LESSONS', 'Adicione ao menos uma aula antes de enviar para análise ou publicar.'])
      expect(await linha(c.id, 'status, approved_at')).toEqual({ status: 'in_review', approved_at: null })

      // o envio para análise sem aula responde exatamente o mesmo
      const rascunho = await seedCourse(t, { tenantId: w.a.id, slug: `sem-aula-${randomUUID().slice(0, 8)}`, title: 'Sem Aula', instructorId: w.u.teacherA, status: 'draft' })
      await t.pool.query('DELETE FROM lessons WHERE id = ?', [rascunho.lessonId])
      const envio = await status(rascunho.id, 'in_review', profA())
      expect([envio.status, envio.body.code, envio.body.message]).toEqual([r.status, r.body.code, r.body.message])
      expect((await decidir('return', c.id, { note: 'Curso sem aulas.' })).status).toBe(201)
    })

    it('envios no mesmo instante saem na ordem do id', async () => {
      const mesmoInstante = new Date('2026-02-01T10:00:00Z')
      const x = await cursoEmAnalise({ tenantId: w.a.id, instructorId: w.u.teacherA, submittedAt: mesmoInstante })
      const y = await cursoEmAnalise({ tenantId: w.b.id, instructorId: w.u.teacherB, submittedAt: mesmoInstante })
      const z = await cursoEmAnalise({ tenantId: w.a.id, instructorId: w.u.teacherA, submittedAt: mesmoInstante })
      expect((await fila()).map((i) => i.courseId)).toEqual([x.id, y.id, z.id].sort())
      for (const c of [x, y, z]) expect((await decidir('return', c.id, { note: 'Fim do teste.' })).status).toBe(201)
    })

    it('a devolução e a retirada levam a nota ao log, cortada em 200 caracteres', async () => {
      const c = await cursoEmAnalise({ tenantId: w.a.id, instructorId: w.u.teacherA })
      const { title } = (await linha(c.id, 'title')) as { title: string }
      const longa = `${'Rever a ementa. '.repeat(20)}Fim.`
      expect((await decidir('return', c.id, { note: longa })).status).toBe(201)
      const resumo = (acao: string) =>
        eventually(
          async () => ((await t.pool.query('SELECT summary FROM audit_logs WHERE action = ? AND target_id = ?', [acao, c.id]))[0] as Array<{ summary: string }>).map((r) => r.summary),
          (v) => v.length > 0
        )
      const [devolucao] = await resumo('course.return')
      const cortada = `${longa.replace(/\s+/g, ' ').trim().slice(0, 199).trimEnd()}…`
      expect(devolucao).toBe(`Studio Pilari devolveu o curso "${title}" para ajustes: ${cortada}`)
      expect(cortada.length).toBeLessThanOrEqual(200)

      expect((await status(c.id, 'in_review', profA())).status).toBe(200)
      expect((await aprovar(c.id)).status).toBe(201)
      expect((await decidir('takedown', c.id, { note: '  Vídeo com direitos autorais.  ' })).status).toBe(201)
      expect(await resumo('course.takedown')).toEqual([`Studio Pilari tirou do ar o curso "${title}": Vídeo com direitos autorais.`])
    })

    describe('corrida: o curso mudou de situação entre a leitura e a gravação', () => {
      const CORRIDA = { statusCode: 400, code: 'INVALID_TRANSITION', message: 'O curso mudou de situação enquanto você decidia. Recarregue a página.' }
      type Leitura = { curso: (id: string) => Promise<Record<string, unknown>> }
      /** A próxima leitura do curso pelo console devolve a foto de antes: o banco já mudou quando o UPDATE chega. */
      const leituraVelha = (foto: Record<string, unknown>) =>
        jest.spyOn(app.app.get(PlatformReviewService) as unknown as Leitura, 'curso').mockResolvedValueOnce(foto)
      const fotoDe = async (id: string) => {
        const [rows] = await t.pool.query('SELECT * FROM courses WHERE id = ?', [id])
        const r = (rows as Array<Record<string, unknown>>)[0]
        return {
          ...r, tenantId: r.tenant_id, workloadHours: r.workload_hours, coordinatorName: r.coordinator_name, coordinatorRole: r.coordinator_role,
          coordinatorSignaturePath: r.coordinator_signature_path, approvedAt: r.approved_at, approvedBy: r.approved_by, publishedAt: r.published_at,
          reviewNote: r.review_note,
        }
      }
      afterEach(() => jest.restoreAllMocks())

      it('aprovar curso que o instrutor tirou da análise no meio da decisão: 400 e o curso fica como o instrutor deixou', async () => {
        const c = await cursoEmAnalise({ tenantId: w.a.id, instructorId: w.u.teacherA })
        const vista = (await itemDaFila(c.id))?.fingerprint
        const foto = await fotoDe(c.id)
        expect((await status(c.id, 'draft', profA())).status).toBe(200) // o instrutor desiste da análise
        leituraVelha(foto)
        const r = await decidir('approve', c.id, { fingerprint: vista })
        expect([r.status, r.body]).toEqual([400, CORRIDA])
        expect(await linha(c.id, 'status, approved_at, published_at')).toEqual({ status: 'draft', approved_at: null, published_at: null })
      })

      it('devolver e tirar do ar também só gravam sobre a situação que leram', async () => {
        const emAnalise = await cursoEmAnalise({ tenantId: w.a.id, instructorId: w.u.teacherA })
        const foto = await fotoDe(emAnalise.id)
        expect((await status(emAnalise.id, 'draft', profA())).status).toBe(200)
        leituraVelha(foto)
        expect((await decidir('return', emAnalise.id, { note: 'Faltou a ementa.' })).body).toEqual(CORRIDA)
        expect(await linha(emAnalise.id, 'status, review_note')).toEqual({ status: 'draft', review_note: null })

        const publicado = await seedCourse(t, { tenantId: w.b.id, slug: `corrida-${randomUUID().slice(0, 8)}`, title: 'Corrida no B', instructorId: w.u.teacherB })
        const fotoPublicado = await fotoDe(publicado.id)
        await t.pool.query("UPDATE courses SET status = 'archived' WHERE id = ?", [publicado.id]) // o polo arquivou antes
        leituraVelha(fotoPublicado)
        expect((await decidir('takedown', publicado.id, { note: 'Direitos autorais.' })).body).toEqual(CORRIDA)
        expect(await linha(publicado.id, 'status, review_note')).toEqual({ status: 'archived', review_note: null })
      })

      it('o polo muda o título entre a conferência do fingerprint e a gravação: 409 COURSE_CHANGED, nada aprovado', async () => {
        const c = await cursoEmAnalise({ tenantId: w.a.id, instructorId: w.u.teacherA })
        const vista = (await itemDaFila(c.id))?.fingerprint
        const outra = await t.pool.getConnection()
        try {
          // Outra transação (o polo salvando o curso) segura a linha: a aprovação confere o fingerprint e para no UPDATE.
          await outra.query('START TRANSACTION')
          await outra.query('SELECT id FROM courses WHERE id = ? FOR UPDATE', [c.id])
          const resposta = decidir('approve', c.id, { fingerprint: vista }).then((r) => r)
          await eventually(
            async () => Number(((await t.pool.query("SELECT COUNT(*) AS n FROM information_schema.innodb_trx WHERE trx_state = 'LOCK WAIT'"))[0] as Array<{ n: number }>)[0].n),
            (n) => n > 0,
            10_000 // em máquina carregada a requisição pode demorar a chegar na trava
          )
          await outra.query("UPDATE courses SET title = 'Título Trocado no Meio' WHERE id = ?", [c.id])
          await outra.query('COMMIT')
          const r = await resposta
          expect([r.status, r.body]).toEqual([409, MUDOU])
          expect(await linha(c.id, 'status, approved_at, title')).toEqual({ status: 'in_review', approved_at: null, title: 'Título Trocado no Meio' })
        } finally {
          outra.release()
        }
        expect((await decidir('return', c.id, { note: 'Fim do teste.' })).status).toBe(201)
      })
    })
  })
})
