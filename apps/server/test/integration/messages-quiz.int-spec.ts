import { randomUUID } from 'node:crypto'
import { quizAttempts, quizQuestions } from '../../src/db/schema'
import { bootTestApp, type TestApp } from './helpers/app'
import { createTestDatabase, type TestDatabase } from './helpers/db'
import { bearer, seedCourse, seedEnrollment, seedMember, seedTwoPolos, seedUser, type TwoPolos } from './helpers/seed'

describe('mensagens e provas por polo', () => {
  let t: TestDatabase
  let app: TestApp
  let w: TwoPolos
  /** Colega de A: instrutor sem curso nenhum, para o 403 entre colegas do mesmo polo. */
  const colegaA = 'u-prof-a2'
  /** Instrutor dos DOIS polos, com `curso-ab` em cada: só o polo do endereço separa as caixas dele. */
  const profAB = 'u-prof-ab'

  beforeAll(async () => {
    t = await createTestDatabase()
    app = await bootTestApp(t.url)
    w = await seedTwoPolos(t)
    await seedUser(t, { uid: colegaA })
    await seedMember(t, w.a.id, colegaA, ['teacher'])
    await seedUser(t, { uid: profAB })
    await seedMember(t, w.a.id, profAB, ['teacher'])
    await seedMember(t, w.b.id, profAB, ['teacher'])
    for (const [polo, titulo] of [[w.a, 'Curso AB no A'], [w.b, 'Curso AB no B']] as const) {
      const curso = await seedCourse(t, { tenantId: polo.id, slug: 'curso-ab', title: titulo, instructorId: profAB })
      await seedEnrollment(t, { userId: w.u.shared, courseId: curso.id })
    }
    await seedCourse(t, { tenantId: w.b.id, slug: 'so-no-b', title: 'Só no B', instructorId: w.u.teacherB })
  })
  afterAll(async () => {
    try {
      await app?.close()
    } finally {
      await t?.drop()
    }
  })

  it('a mensagem do aluno vai para o curso do polo do endereço', async () => {
    await app.http().post('/api/me/courses/excel-basico/messages').set('Host', w.b.host).set('Authorization', bearer(w.u.shared)).send({ body: 'dúvida no B' })
    const caixaA = await app.http().get('/api/instructor/conversations').set('Host', w.a.host).set('Authorization', bearer(w.u.adminA))
    const caixaB = await app.http().get('/api/instructor/conversations').set('Host', w.b.host).set('Authorization', bearer(w.u.adminB))
    expect(caixaA.body.conversations).toEqual([])
    expect(JSON.stringify(caixaB.body)).toContain('dúvida no B')
  })

  it('responder em curso de outro polo responde 404', async () => {
    const r = await app.http().post(`/api/instructor/courses/${w.courses.b.id}/students/${w.u.shared}/messages`).set('Host', w.a.host).set('Authorization', bearer(w.u.adminA)).send({ body: 'x' })
    expect(r.status).toBe(404)
  })

  it('prova de módulo de outro polo responde 404', async () => {
    const r = await app.http().get(`/api/me/modules/${w.courses.a.moduleId}/quiz`).set('Host', w.b.host).set('Authorization', bearer(w.u.shared))
    expect(r.status).toBe(404)
  })

  it('questão em módulo de outro polo responde 404 para o admin', async () => {
    const r = await app.http().get(`/api/instructor/modules/${w.courses.b.moduleId}/questions`).set('Host', w.a.host).set('Authorization', bearer(w.u.adminA))
    expect(r.status).toBe(404)
  })

  it('o boletim pelo slug é do curso do polo do endereço', async () => {
    expect((await app.http().get('/api/me/courses/excel-basico/grades').set('Host', w.a.host).set('Authorization', bearer(w.u.studentA))).status).toBe(200)
    expect((await app.http().get('/api/me/courses/excel-basico/grades').set('Host', w.b.host).set('Authorization', bearer(w.u.studentA))).status).toBe(403)
  })

  // Os cinco testes de cima são os do enunciado e dependem do estado semeado (a caixa do polo A começa
  // vazia). Os de baixo gravam por cima disso, por isso vêm depois.

  const como = (host: string, uid: string) => ({ Host: host, Authorization: bearer(uid) })
  const contar = async (tabela: string, onde: string, valores: unknown[]): Promise<number> => {
    const [rows] = await t.pool.query(`SELECT COUNT(*) AS n FROM ${tabela} WHERE ${onde}`, valores)
    return Number((rows as Array<{ n: number }>)[0].n)
  }
  const corpos = (thread: { body: { messages: Array<{ body: string }> } }): string[] => thread.body.messages.map((m) => m.body)
  const idsDosModulos = (boletim: { body: { modules: Array<{ moduleId: string }> } }): string[] => boletim.body.modules.map((m) => m.moduleId)

  describe('mensagens', () => {
    it('a mensagem nasce só no curso do polo do endereço, e o aluno a lê só por ele', async () => {
      const noA = await app.http().post('/api/me/courses/excel-basico/messages').set(como(w.a.host, w.u.shared)).send({ body: 'oi do A' })
      const noB = await app.http().post('/api/me/courses/excel-basico/messages').set(como(w.b.host, w.u.shared)).send({ body: 'oi do B' })
      expect([noA.status, noB.status]).toEqual([201, 201])
      expect(noA.body.message.courseId).toBe(w.courses.a.id)
      expect(noB.body.message.courseId).toBe(w.courses.b.id)
      expect(await contar('messages', 'course_id = ? AND body = ?', [w.courses.a.id, 'oi do A'])).toBe(1)
      expect(await contar('messages', 'course_id = ? AND body = ?', [w.courses.b.id, 'oi do B'])).toBe(1)
      expect(await contar('messages', 'course_id = ? AND body IN (?, ?)', [w.courses.matriz.id, 'oi do A', 'oi do B'])).toBe(0)

      const lerA = await app.http().get('/api/me/courses/excel-basico/messages').set(como(w.a.host, w.u.shared))
      const lerB = await app.http().get('/api/me/courses/excel-basico/messages').set(como(w.b.host, w.u.shared))
      expect(lerA.body.courseId).toBe(w.courses.a.id)
      expect(corpos(lerA)).toContain('oi do A')
      expect(corpos(lerA)).not.toContain('oi do B')
      expect(lerB.body.courseId).toBe(w.courses.b.id)
      expect(corpos(lerB)).toContain('oi do B')
      expect(corpos(lerB)).not.toContain('oi do A')
    })

    it('o aluno do A não escreve, pelo endereço do B, no curso de mesmo slug; slug que só existe no B é 404 no A', async () => {
      // No B o curso existe e o aluno não está nele: é falta de acesso (403), não de curso.
      const noB = await app.http().post('/api/me/courses/excel-basico/messages').set(como(w.b.host, w.u.studentA)).send({ body: 'intruso' })
      expect(noB.status).toBe(403)
      const escreverNoA = await app.http().post('/api/me/courses/so-no-b/messages').set(como(w.a.host, w.u.shared)).send({ body: 'intruso' })
      const lerNoA = await app.http().get('/api/me/courses/so-no-b/messages').set(como(w.a.host, w.u.shared))
      expect([escreverNoA.status, lerNoA.status]).toEqual([404, 404])
      expect(await contar('messages', 'body = ?', ['intruso'])).toBe(0)
    })

    it('a caixa do instrutor traz só as conversas dos cursos dele NESTE polo; a do admin, todas as do polo', async () => {
      for (const host of [w.a.host, w.b.host]) {
        for (const slug of ['excel-basico', 'curso-ab']) {
          const r = await app.http().post(`/api/me/courses/${slug}/messages`).set(como(host, w.u.shared)).send({ body: `dúvida do ${slug}` })
          expect(r.status).toBe(201)
        }
      }
      const caixa = async (host: string, uid: string): Promise<string[]> => {
        const r = await app.http().get('/api/instructor/conversations').set(como(host, uid))
        expect(r.status).toBe(200)
        return (r.body.conversations as Array<{ courseTitle: string }>).map((c) => c.courseTitle).sort()
      }
      // O mesmo instrutor nos dois polos: o filtro por instrutor sozinho misturaria as caixas.
      expect(await caixa(w.a.host, profAB)).toEqual(['Curso AB no A'])
      expect(await caixa(w.b.host, profAB)).toEqual(['Curso AB no B'])
      expect(await caixa(w.a.host, w.u.teacherA)).toEqual(['Excel do Polo A'])
      expect(await caixa(w.a.host, colegaA)).toEqual([])
      expect(await caixa(w.a.host, w.u.adminA)).toEqual(['Curso AB no A', 'Excel do Polo A'])
      expect(await caixa(w.b.host, w.u.adminB)).toEqual(['Curso AB no B', 'Excel do Polo B'])
      // A plataforma administra o polo do endereço, não a rede inteira.
      expect(await caixa(w.a.host, w.u.platform)).toEqual(['Curso AB no A', 'Excel do Polo A'])
      expect(await caixa(w.b.host, w.u.platform)).toEqual(['Curso AB no B', 'Excel do Polo B'])
    })

    it('ler a conversa de curso de outro polo responde 404 e não marca nada como lido', async () => {
      await app.http().post('/api/me/courses/excel-basico/messages').set(como(w.b.host, w.u.shared)).send({ body: 'pergunta para leitura' })
      const lidaEm = async (): Promise<Date | null> => {
        const [rows] = await t.pool.query('SELECT read_at FROM messages WHERE body = ?', ['pergunta para leitura'])
        return (rows as Array<{ read_at: Date | null }>)[0].read_at
      }
      const conversa = `/api/instructor/courses/${w.courses.b.id}/students/${w.u.shared}/messages`

      expect((await app.http().get(conversa).set(como(w.a.host, w.u.adminA))).status).toBe(404)
      expect((await app.http().get(conversa).set(como(w.a.host, w.u.platform))).status).toBe(404)
      expect(await lidaEm()).toBeNull()

      const doB = await app.http().get(conversa).set(como(w.b.host, w.u.adminB))
      expect(doB.status).toBe(200)
      expect(corpos(doB)).toContain('pergunta para leitura')
      expect(await lidaEm()).not.toBeNull()
    })

    it('responder: curso de outro polo é 404 e nada é gravado; o dono e o admin do polo respondem; colega do mesmo polo recebe 403', async () => {
      const enviar = (host: string, uid: string, cursoId: string, texto: string) =>
        app.http().post(`/api/instructor/courses/${cursoId}/students/${w.u.shared}/messages`).set(como(host, uid)).send({ body: texto })

      expect((await enviar(w.a.host, w.u.adminA, w.courses.b.id, 'resposta invasora')).status).toBe(404)
      expect((await enviar(w.a.host, w.u.platform, w.courses.b.id, 'resposta da plataforma no B')).status).toBe(404)
      expect((await enviar(w.a.host, colegaA, w.courses.a.id, 'resposta do colega')).status).toBe(403)
      expect(await contar('messages', 'sender_id IN (?, ?, ?)', [w.u.adminA, w.u.platform, colegaA])).toBe(0)

      expect((await enviar(w.b.host, w.u.teacherB, w.courses.b.id, 'resposta do B')).status).toBe(201)
      expect((await enviar(w.a.host, w.u.platform, w.courses.a.id, 'resposta da plataforma no A')).status).toBe(201)

      const lerA = await app.http().get('/api/me/courses/excel-basico/messages').set(como(w.a.host, w.u.shared))
      const lerB = await app.http().get('/api/me/courses/excel-basico/messages').set(como(w.b.host, w.u.shared))
      expect(corpos(lerB)).toContain('resposta do B')
      expect(corpos(lerB)).not.toContain('resposta da plataforma no A')
      expect(corpos(lerA)).toContain('resposta da plataforma no A')
      expect(corpos(lerA)).not.toContain('resposta do B')
      const resposta = (lerB.body.messages as Array<{ body: string; fromStudent: boolean }>).find((m) => m.body === 'resposta do B')
      expect(resposta?.fromStudent).toBe(false)
    })
  })

  describe('provas', () => {
    const doModulo = (moduloId: string) => `/api/instructor/modules/${moduloId}/questions`
    const daQuestao = (id: string) => `/api/instructor/questions/${id}`
    const questao = { prompt: 'Quanto é 1 + 1?', options: ['1', '2'], correctIndex: 1, points: 10 }
    /** Questão do módulo do A, semeada no banco: os testes do aluno não dependem do de autoria. */
    let questaoA: string

    beforeAll(async () => {
      questaoA = randomUUID()
      await t.db.insert(quizQuestions).values({ id: questaoA, moduleId: w.courses.a.moduleId, prompt: questao.prompt, options: questao.options, correctIndex: questao.correctIndex, order: 0 })
    })

    it('o instrutor cria, lista, edita e apaga questão no módulo do próprio curso', async () => {
      const criada = await app.http().post(doModulo(w.courses.a.moduleId)).set(como(w.a.host, w.u.teacherA)).send(questao)
      expect(criada.status).toBe(201)
      const id = criada.body.id as string

      const lista = await app.http().get(doModulo(w.courses.a.moduleId)).set(como(w.a.host, w.u.teacherA))
      expect(lista.status).toBe(200)
      expect((lista.body.questions as Array<{ id: string }>).map((q) => q.id)).toEqual([questaoA, id])

      expect((await app.http().patch(daQuestao(id)).set(como(w.a.host, w.u.teacherA)).send({ prompt: 'Quanto é 2 + 2?' })).status).toBe(200)
      expect(await contar('quiz_questions', 'id = ? AND prompt = ?', [id, 'Quanto é 2 + 2?'])).toBe(1)

      expect((await app.http().delete(daQuestao(id)).set(como(w.a.host, w.u.teacherA))).status).toBe(200)
      expect(await contar('quiz_questions', 'id = ?', [id])).toBe(0)
    })

    it('módulo e questão de outro polo respondem 404 ao admin e ao instrutor do polo A, e nada muda', async () => {
      const criada = await app.http().post(doModulo(w.courses.b.moduleId)).set(como(w.b.host, w.u.adminB)).send(questao)
      expect(criada.status).toBe(201)
      const questaoB = criada.body.id as string

      for (const uid of [w.u.adminA, w.u.teacherA, w.u.platform]) {
        expect((await app.http().get(doModulo(w.courses.b.moduleId)).set(como(w.a.host, uid))).status).toBe(404)
        expect((await app.http().post(doModulo(w.courses.b.moduleId)).set(como(w.a.host, uid)).send(questao)).status).toBe(404)
        expect((await app.http().patch(daQuestao(questaoB)).set(como(w.a.host, uid)).send({ prompt: 'invasão' })).status).toBe(404)
        expect((await app.http().delete(daQuestao(questaoB)).set(como(w.a.host, uid))).status).toBe(404)
      }
      expect(await contar('quiz_questions', 'module_id = ?', [w.courses.b.moduleId])).toBe(1)
      expect(await contar('quiz_questions', 'id = ? AND prompt = ?', [questaoB, questao.prompt])).toBe(1)

      // No polo dono, o admin edita e apaga.
      expect((await app.http().patch(daQuestao(questaoB)).set(como(w.b.host, w.u.adminB)).send({ prompt: 'editada no B' })).status).toBe(200)
      expect(await contar('quiz_questions', 'id = ? AND prompt = ?', [questaoB, 'editada no B'])).toBe(1)
      expect((await app.http().delete(daQuestao(questaoB)).set(como(w.b.host, w.u.adminB))).status).toBe(200)
      expect(await contar('quiz_questions', 'module_id = ?', [w.courses.b.moduleId])).toBe(0)
    })

    it('colega do mesmo polo recebe 403 no módulo de curso alheio; o admin do polo passa', async () => {
      expect((await app.http().get(doModulo(w.courses.a.moduleId)).set(como(w.a.host, colegaA))).status).toBe(403)
      expect((await app.http().post(doModulo(w.courses.a.moduleId)).set(como(w.a.host, colegaA)).send(questao)).status).toBe(403)
      expect((await app.http().patch(daQuestao(questaoA)).set(como(w.a.host, colegaA)).send({ prompt: 'do colega' })).status).toBe(403)
      expect((await app.http().delete(daQuestao(questaoA)).set(como(w.a.host, colegaA))).status).toBe(403)
      expect(await contar('quiz_questions', 'module_id = ?', [w.courses.a.moduleId])).toBe(1)
      expect(await contar('quiz_questions', 'id = ? AND prompt = ?', [questaoA, questao.prompt])).toBe(1)
      expect((await app.http().get(doModulo(w.courses.a.moduleId)).set(como(w.a.host, w.u.adminA))).status).toBe(200)
    })

    it('a prova e o envio do aluno valem só no polo do módulo', async () => {
      const tentativas = () => contar('quiz_attempts', 'user_id = ? AND module_id = ?', [w.u.shared, w.courses.a.moduleId])
      const antes = await tentativas()
      const prova = await app.http().get(`/api/me/modules/${w.courses.a.moduleId}/quiz`).set(como(w.a.host, w.u.shared))
      expect(prova.status).toBe(200)
      expect(prova.body.questions).toHaveLength(1)

      const envio = await app.http().post(`/api/me/modules/${w.courses.a.moduleId}/quiz/submit`).set(como(w.a.host, w.u.shared)).send({ answers: { [questaoA]: 1 } })
      expect(envio.status).toBe(201)
      expect(envio.body.score).toBe(100)
      expect(await tentativas()).toBe(antes + 1)

      // O mesmo módulo pelo endereço do B: 404, e nenhuma tentativa nova.
      const noB = await app.http().post(`/api/me/modules/${w.courses.a.moduleId}/quiz/submit`).set(como(w.b.host, w.u.shared)).send({ answers: { [questaoA]: 1 } })
      expect(noB.status).toBe(404)
      expect(await tentativas()).toBe(antes + 1)
      // O módulo do B pelo endereço do A é 404; pelo próprio B, o aluno compartilhado abre a prova.
      expect((await app.http().get(`/api/me/modules/${w.courses.b.moduleId}/quiz`).set(como(w.a.host, w.u.shared))).status).toBe(404)
      expect((await app.http().get(`/api/me/modules/${w.courses.b.moduleId}/quiz`).set(como(w.b.host, w.u.shared))).status).toBe(200)
    })

    it('o boletim pelo slug é do curso do polo do endereço, também para quem estuda nos dois', async () => {
      // Tentativa de 100 no módulo do A, semeada aqui: o teste não depende do envio do anterior.
      await t.db.insert(quizAttempts).values({ id: randomUUID(), userId: w.u.shared, moduleId: w.courses.a.moduleId, score: 100, passed: true })
      const noA = await app.http().get('/api/me/courses/excel-basico/grades').set(como(w.a.host, w.u.shared))
      const noB = await app.http().get('/api/me/courses/excel-basico/grades').set(como(w.b.host, w.u.shared))
      expect([noA.status, noB.status]).toEqual([200, 200])
      expect(idsDosModulos(noA)).toEqual([w.courses.a.moduleId])
      expect(idsDosModulos(noB)).toEqual([w.courses.b.moduleId])
      // A tentativa de 100 é do módulo do A; o curso do B não tem nota nenhuma.
      expect(noA.body.modules[0].grade).toBe(10)
      expect(noB.body.modules[0].grade).toBeNull()

      // Slug que só existe no B: 404 no A; no B o curso existe e o aluno não está nele.
      expect((await app.http().get('/api/me/courses/so-no-b/grades').set(como(w.a.host, w.u.shared))).status).toBe(404)
      expect((await app.http().get('/api/me/courses/so-no-b/grades').set(como(w.b.host, w.u.shared))).status).toBe(403)
    })

    it('o boletim de um aluno visto pela equipe: curso de outro polo é 404; colega do mesmo polo, 403', async () => {
      const boletim = (host: string, uid: string, cursoId: string) =>
        app.http().get(`/api/instructor/courses/${cursoId}/students/${w.u.shared}/grades`).set(como(host, uid))

      expect((await boletim(w.a.host, w.u.adminA, w.courses.b.id)).status).toBe(404)
      expect((await boletim(w.a.host, w.u.platform, w.courses.b.id)).status).toBe(404)
      expect((await boletim(w.a.host, colegaA, w.courses.a.id)).status).toBe(403)

      const doB = await boletim(w.b.host, w.u.adminB, w.courses.b.id)
      expect(doB.status).toBe(200)
      expect(idsDosModulos(doB)).toEqual([w.courses.b.moduleId])
      const doA = await boletim(w.a.host, w.u.teacherA, w.courses.a.id)
      expect(doA.status).toBe(200)
      expect(idsDosModulos(doA)).toEqual([w.courses.a.moduleId])
    })

    it('liberar tentativas: curso de outro polo é 404; colega, 403; o dono libera só a matrícula do curso dele', async () => {
      const rodadas = async (cursoId: string): Promise<number> => {
        const [rows] = await t.pool.query('SELECT quiz_attempt_rounds AS n FROM enrollments WHERE user_id = ? AND course_id = ?', [w.u.shared, cursoId])
        return Number((rows as Array<{ n: number }>)[0].n)
      }
      const liberar = (host: string, uid: string, cursoId: string) =>
        app.http().post(`/api/instructor/courses/${cursoId}/students/${w.u.shared}/quiz-release`).set(como(host, uid))

      expect((await liberar(w.a.host, w.u.adminA, w.courses.b.id)).status).toBe(404)
      expect((await liberar(w.a.host, w.u.platform, w.courses.b.id)).status).toBe(404)
      expect((await liberar(w.a.host, colegaA, w.courses.a.id)).status).toBe(403)
      expect([await rodadas(w.courses.a.id), await rodadas(w.courses.b.id)]).toEqual([1, 1])

      expect((await liberar(w.b.host, w.u.teacherB, w.courses.b.id)).status).toBe(201)
      expect([await rodadas(w.courses.a.id), await rodadas(w.courses.b.id)]).toEqual([1, 2])
    })

    it('tentativas esgotadas: nos polos o aluno fala com o professor ou com o polo; na matriz, com a secretaria', async () => {
      /** Uma questão no módulo e as cinco tentativas da rodada já usadas pelo aluno. */
      const esgotar = async (uid: string, moduleId: string) => {
        await t.db.insert(quizQuestions).values({ id: randomUUID(), moduleId, prompt: questao.prompt, options: questao.options, correctIndex: questao.correctIndex, order: 0 })
        for (let i = 0; i < 5; i++) await t.db.insert(quizAttempts).values({ id: randomUUID(), userId: uid, moduleId, score: 0, passed: false })
      }
      const enviar = (host: string, uid: string, moduleId: string) =>
        app.http().post(`/api/me/modules/${moduleId}/quiz/submit`).set(como(host, uid)).send({ answers: {} })

      await esgotar(w.u.studentB, w.courses.b.moduleId)
      const noPolo = await enviar(w.b.host, w.u.studentB, w.courses.b.moduleId)
      expect([noPolo.status, noPolo.body.message]).toEqual([
        400, 'Tentativas esgotadas neste módulo. Fale com o professor do curso ou com o seu polo para liberar novas tentativas.',
      ])

      await seedEnrollment(t, { userId: w.u.studentA, courseId: w.courses.matriz.id })
      await esgotar(w.u.studentA, w.courses.matriz.moduleId)
      const naMatriz = await enviar(w.matriz.host, w.u.studentA, w.courses.matriz.moduleId)
      expect([naMatriz.status, naMatriz.body.message]).toEqual([400, 'Tentativas esgotadas neste módulo. Fale com o Studio Pilari para liberar novas tentativas.'])
      // nenhuma tentativa a mais foi gravada
      expect(await contar('quiz_attempts', 'user_id = ? AND module_id = ?', [w.u.studentB, w.courses.b.moduleId])).toBe(5)
    })
  })
})
