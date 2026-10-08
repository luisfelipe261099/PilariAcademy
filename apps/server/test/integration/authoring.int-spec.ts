import { randomBytes, randomUUID } from 'node:crypto'
import type { CourseStatus } from '@pilari/types'
import { lessonAttachments, lessons, modules, quizQuestions } from '../../src/db/schema'
import { bootTestApp, type TestApp } from './helpers/app'
import { createTestDatabase, esperasDeLock, type TestDatabase } from './helpers/db'
import { bearer, seedCategory, seedCourse, seedEnrollment, seedMember, seedTwoPolos, seedUser, type TwoPolos } from './helpers/seed'
import { eventually } from './helpers/wait'

type Metodo = 'get' | 'post' | 'put' | 'patch' | 'delete'

describe('autoria por polo', () => {
  let t: TestDatabase
  let app: TestApp
  let w: TwoPolos
  /** Segundo instrutor do polo A: não é dono de nada, para provar o 403 entre colegas do mesmo polo. */
  const colegaA = 'u-prof-a2'
  /** Instrutor dos DOIS polos, com um curso em cada: aí só o polo do endereço separa um do outro. */
  const profAB = 'u-prof-ab'
  let cursoABnoA: string
  let cursoABnoB: string

  beforeAll(async () => {
    t = await createTestDatabase()
    app = await bootTestApp(t.url)
    w = await seedTwoPolos(t)
    await seedUser(t, { uid: colegaA })
    await seedMember(t, w.a.id, colegaA, ['teacher'])
    await seedUser(t, { uid: profAB })
    await seedMember(t, w.a.id, profAB, ['teacher'])
    await seedMember(t, w.b.id, profAB, ['teacher'])
    cursoABnoA = (await seedCourse(t, { tenantId: w.a.id, slug: 'curso-ab', title: 'Curso AB no A', instructorId: profAB })).id
    cursoABnoB = (await seedCourse(t, { tenantId: w.b.id, slug: 'curso-ab', title: 'Curso AB no B', instructorId: profAB })).id
  })
  afterAll(async () => {
    try {
      await app?.close()
    } finally {
      await t?.drop()
    }
  })

  const como = (host: string, uid: string) => ({ Host: host, Authorization: bearer(uid) })
  const chamar = (metodo: Metodo, host: string, uid: string, caminho: string, corpo?: object) => {
    const req = app.http()[metodo](`/api/instructor${caminho}`).set(como(host, uid))
    return corpo ? req.send(corpo) : req
  }
  const contar = async (tabela: string, onde: string, id: string): Promise<number> => {
    const [rows] = await t.pool.query(`SELECT COUNT(*) AS n FROM ${tabela} WHERE ${onde} = ?`, [id])
    return Number((rows as Array<{ n: number }>)[0].n)
  }

  it('o instrutor lista só os próprios cursos do polo do endereço', async () => {
    const r = await app.http().get('/api/instructor/courses').set(como(w.a.host, w.u.teacherA))
    expect((r.body.courses as Array<{ title: string }>).map((c) => c.title).sort()).toEqual(['Excel do Polo A', 'Rascunho do Polo A'])
  })

  it('curso criado nasce no polo do endereço, com slug único dentro dele', async () => {
    const r = await app.http().post('/api/instructor/courses').set(como(w.a.host, w.u.teacherA)).send({ title: 'Excel Básico' })
    expect(r.status).toBe(201)
    expect(r.body.course.slug).toBe('excel-basico-2')
    const [rows] = await t.pool.query('SELECT tenant_id FROM courses WHERE id = ?', [r.body.course.id])
    expect(rows).toEqual([{ tenant_id: w.a.id }])
  })

  it('admin do polo A não edita curso do polo B pelo endereço do A', async () => {
    const r = await app.http().patch(`/api/instructor/courses/${w.courses.b.id}`).set(como(w.a.host, w.u.adminA)).send({ subtitle: 'invasão' })
    expect(r.status).toBe(404)
  })

  it('instrutor sem papel no polo B não entra na autoria do B', async () => {
    expect((await app.http().get('/api/instructor/courses').set(como(w.b.host, w.u.teacherA))).status).toBe(403)
  })

  it('upload de arquivo para curso de outro polo responde 404', async () => {
    const r = await app.http().post('/api/instructor/upload-url').set(como(w.a.host, w.u.adminA))
      .send({ kind: 'cover', courseId: w.courses.b.id, fileName: 'capa.png', contentType: 'image/png' })
    expect(r.status).toBe(404)
  })

  it('aula de outro polo responde 404', async () => {
    const r = await app.http().patch(`/api/instructor/lessons/${w.courses.b.lessonId}`).set(como(w.a.host, w.u.adminA)).send({ title: 'x' })
    expect(r.status).toBe(404)
  })

  describe('o polo do endereço separa quem é dono nos dois polos', () => {
    it('a listagem do instrutor dos dois polos mostra, em cada endereço, só o curso daquele polo', async () => {
      const noA = await app.http().get('/api/instructor/courses').set(como(w.a.host, profAB))
      const noB = await app.http().get('/api/instructor/courses').set(como(w.b.host, profAB))
      expect((noA.body.courses as Array<{ id: string }>).map((c) => c.id)).toEqual([cursoABnoA])
      expect((noB.body.courses as Array<{ id: string }>).map((c) => c.id)).toEqual([cursoABnoB])
    })

    it('o curso é do instrutor, mas está em outro polo: pelo endereço errado é 404, não posse', async () => {
      const r = await chamar('patch', w.a.host, profAB, `/courses/${cursoABnoB}`, { subtitle: 'no endereço errado' })
      expect(r.status).toBe(404)
      const certo = await chamar('patch', w.b.host, profAB, `/courses/${cursoABnoB}`, { subtitle: 'no endereço certo' })
      expect(certo.status).toBe(200)
      expect(certo.body.course.subtitle).toBe('no endereço certo')
    })
  })

  describe('posse dentro do polo', () => {
    it('instrutor não mexe no curso de um colega do mesmo polo (403), mas o admin do polo mexe', async () => {
      const colega = await chamar('patch', w.a.host, colegaA, `/courses/${w.courses.a.id}`, { subtitle: 'do colega' })
      expect(colega.status).toBe(403)
      expect((await chamar('get', w.a.host, colegaA, `/courses/${w.courses.a.id}/meta`)).status).toBe(403)
      const admin = await chamar('patch', w.a.host, w.u.adminA, `/courses/${w.courses.a.id}`, { subtitle: 'ajustado pelo admin' })
      expect(admin.status).toBe(200)
      expect(admin.body.course.subtitle).toBe('ajustado pelo admin')
    })

    it('o admin da plataforma abre o curso do polo do endereço, e só dele', async () => {
      const noA = await chamar('get', w.a.host, w.u.platform, `/courses/${w.courses.a.id}/meta`)
      expect(noA.status).toBe(200)
      expect(noA.body.course.id).toBe(w.courses.a.id)
      expect((await chamar('get', w.a.host, w.u.platform, `/courses/${w.courses.b.id}/meta`)).status).toBe(404)
    })

    it('upload-url: o dono recebe o ticket dentro do prefixo do curso; o colega do polo recebe 403', async () => {
      const corpo = { kind: 'cover', courseId: w.courses.a.id, fileName: 'capa final.png', contentType: 'image/png' }
      const ok = await chamar('post', w.a.host, w.u.teacherA, '/upload-url', corpo)
      expect(ok.status).toBe(201)
      expect(ok.body.objectPath).toMatch(new RegExp(`^cursos/${w.courses.a.id}/cover/[0-9a-f-]{36}-capa_final\\.png$`))
      expect(ok.body.uploadUrl).toBe(`https://upload.fake/${ok.body.objectPath}`)
      expect((await chamar('post', w.a.host, colegaA, '/upload-url', corpo)).status).toBe(403)
    })
  })

  describe('categoria do polo', () => {
    let catA: string
    let catB: string

    beforeAll(async () => {
      catA = await seedCategory(t, { tenantId: w.a.id, name: 'Gestão A', slug: 'gestao' })
      catB = await seedCategory(t, { tenantId: w.b.id, name: 'Gestão B', slug: 'gestao' })
    })

    it('curso novo com categoria de outro polo → 400 e nada é criado', async () => {
      const r = await chamar('post', w.a.host, w.u.teacherA, '/courses', { title: 'Curso Com Categoria Alheia', categoryId: catB })
      expect(r.status).toBe(400)
      expect(r.body.message).toBe('Categoria inválida para este polo.')
      expect(await contar('courses', 'title', 'Curso Com Categoria Alheia')).toBe(0)
    })

    it('curso novo com categoria do próprio polo → 201 e a categoria fica gravada', async () => {
      const r = await chamar('post', w.a.host, w.u.teacherA, '/courses', { title: 'Curso Com Categoria Própria', categoryId: catA })
      expect(r.status).toBe(201)
      expect(r.body.course.categoryId).toBe(catA)
    })

    it('trocar a categoria de um curso para a de outro polo → 400 e a categoria não muda', async () => {
      const r = await chamar('patch', w.a.host, w.u.adminA, `/courses/${w.courses.aDraft.id}`, { categoryId: catB })
      expect(r.status).toBe(400)
      const [rows] = await t.pool.query('SELECT category_id FROM courses WHERE id = ?', [w.courses.aDraft.id])
      expect(rows).toEqual([{ category_id: null }])
      const ok = await chamar('patch', w.a.host, w.u.adminA, `/courses/${w.courses.aDraft.id}`, { categoryId: catA })
      expect(ok.status).toBe(200)
      expect(ok.body.course.categoryId).toBe(catA)
      // e limpar a categoria continua permitido
      const limpa = await chamar('patch', w.a.host, w.u.adminA, `/courses/${w.courses.aDraft.id}`, { categoryId: null })
      expect(limpa.status).toBe(200)
      expect(limpa.body.course.categoryId).toBeNull()
    })
  })

  describe('slug único dentro do polo', () => {
    it('o mesmo título gera o mesmo slug em cada polo, e o sufixo só aparece dentro do polo', async () => {
      const a1 = await chamar('post', w.a.host, w.u.teacherA, '/courses', { title: 'Contabilidade Geral' })
      const b1 = await chamar('post', w.b.host, w.u.teacherB, '/courses', { title: 'Contabilidade Geral' })
      const a2 = await chamar('post', w.a.host, w.u.teacherA, '/courses', { title: 'Contabilidade Geral' })
      expect(a1.body.course.slug).toBe('contabilidade-geral')
      expect(b1.body.course.slug).toBe('contabilidade-geral')
      expect(a2.body.course.slug).toBe('contabilidade-geral-2')
      const [rows] = await t.pool.query('SELECT slug, tenant_id FROM courses WHERE title = ? ORDER BY slug, tenant_id', ['Contabilidade Geral'])
      expect(rows).toHaveLength(3)
    })
  })

  describe('todo id de outro polo responde 404 pelo endereço do A (admin do A)', () => {
    /**
     * Curso do polo B só para esta chamada. Se uma rota deixar de barrar, o estrago fica nele e não
     * leva junto o alvo das rotas seguintes (que passariam por um motivo errado: id que sumiu).
     */
    interface Alvo { cursoId: string; moduloId: string; aulaId: string; anexoId: string }
    let seq = 0
    const novoAlvo = async (): Promise<Alvo> => {
      seq += 1
      const c = await seedCourse(t, { tenantId: w.b.id, slug: `alvo-${seq}`, title: 'Alvo no B', instructorId: w.u.teacherB })
      const anexoId = randomUUID()
      await t.db.insert(lessonAttachments).values({ id: anexoId, lessonId: c.lessonId, fileName: 'alvo.pdf', fileUrl: `cursos/${c.id}/attachment/alvo.pdf` })
      return { cursoId: c.id, moduloId: c.moduleId, aulaId: c.lessonId, anexoId }
    }
    /** O alvo continua exatamente como foi semeado: nada foi criado, editado, reordenado nem apagado. */
    const intacto = async (a: Alvo): Promise<void> => {
      const [cursos] = await t.pool.query('SELECT title, subtitle, status FROM courses WHERE id = ?', [a.cursoId])
      expect(cursos).toEqual([{ title: 'Alvo no B', subtitle: null, status: 'published' }])
      const [modulos] = await t.pool.query('SELECT id, title, available_at FROM modules WHERE course_id = ?', [a.cursoId])
      expect(modulos).toEqual([{ id: a.moduloId, title: 'Módulo 1', available_at: null }])
      const [aulas] = await t.pool.query('SELECT id, title, sort_order FROM lessons WHERE module_id = ?', [a.moduloId])
      expect(aulas).toEqual([{ id: a.aulaId, title: 'Aula 1', sort_order: 0 }])
      const [anexos] = await t.pool.query('SELECT id FROM lesson_attachments WHERE lesson_id = ?', [a.aulaId])
      expect(anexos).toEqual([{ id: a.anexoId }])
    }

    interface Rota { rota: string; metodo: Metodo; caminho: (a: Alvo) => string; corpo?: (a: Alvo) => object; mensagem: string }
    const rotas: Rota[] = [
      { rota: '/courses/:id/meta', metodo: 'get', caminho: (a) => `/courses/${a.cursoId}/meta`, mensagem: 'Curso não encontrado.' },
      { rota: '/courses/:id', metodo: 'get', caminho: (a) => `/courses/${a.cursoId}`, mensagem: 'Curso não encontrado.' },
      { rota: '/courses/:id/signature', metodo: 'get', caminho: (a) => `/courses/${a.cursoId}/signature`, mensagem: 'Curso não encontrado.' },
      { rota: '/courses/:id', metodo: 'patch', caminho: (a) => `/courses/${a.cursoId}`, corpo: () => ({ title: 'invasão' }), mensagem: 'Curso não encontrado.' },
      { rota: '/courses/:id/status', metodo: 'patch', caminho: (a) => `/courses/${a.cursoId}/status`, corpo: () => ({ status: 'draft' }), mensagem: 'Curso não encontrado.' },
      { rota: '/courses/:id', metodo: 'delete', caminho: (a) => `/courses/${a.cursoId}`, mensagem: 'Curso não encontrado.' },
      { rota: '/courses/:id/modules', metodo: 'post', caminho: (a) => `/courses/${a.cursoId}/modules`, corpo: () => ({ title: 'invasão' }), mensagem: 'Curso não encontrado.' },
      { rota: '/courses/:id/modules/reorder', metodo: 'put', caminho: (a) => `/courses/${a.cursoId}/modules/reorder`, corpo: (a) => ({ orderedIds: [a.moduloId] }), mensagem: 'Curso não encontrado.' },
      { rota: '/modules/:id', metodo: 'patch', caminho: (a) => `/modules/${a.moduloId}`, corpo: () => ({ title: 'invasão' }), mensagem: 'Módulo não encontrado.' },
      { rota: '/modules/:id/release', metodo: 'patch', caminho: (a) => `/modules/${a.moduloId}/release`, corpo: () => ({ availableAt: '2030-01-01T00:00:00.000Z' }), mensagem: 'Módulo não encontrado.' },
      { rota: '/modules/:id', metodo: 'delete', caminho: (a) => `/modules/${a.moduloId}`, mensagem: 'Módulo não encontrado.' },
      { rota: '/modules/:id/lessons', metodo: 'post', caminho: (a) => `/modules/${a.moduloId}/lessons`, corpo: () => ({ title: 'invasão' }), mensagem: 'Módulo não encontrado.' },
      { rota: '/modules/:id/lessons/reorder', metodo: 'put', caminho: (a) => `/modules/${a.moduloId}/lessons/reorder`, corpo: (a) => ({ orderedIds: [a.aulaId] }), mensagem: 'Módulo não encontrado.' },
      { rota: '/lessons/:id', metodo: 'patch', caminho: (a) => `/lessons/${a.aulaId}`, corpo: () => ({ title: 'invasão' }), mensagem: 'Aula não encontrada.' },
      { rota: '/lessons/:id', metodo: 'delete', caminho: (a) => `/lessons/${a.aulaId}`, mensagem: 'Aula não encontrada.' },
      { rota: '/lessons/:id/attachments', metodo: 'post', caminho: (a) => `/lessons/${a.aulaId}/attachments`, corpo: () => ({ fileName: 'invasao.pdf', fileUrl: 'https://exemplo.com/invasao.pdf' }), mensagem: 'Aula não encontrada.' },
      { rota: '/attachments/:id', metodo: 'delete', caminho: (a) => `/attachments/${a.anexoId}`, mensagem: 'Aula não encontrada.' },
      { rota: '/upload-url', metodo: 'post', caminho: () => '/upload-url', corpo: (a) => ({ kind: 'attachment', courseId: a.cursoId, fileName: 'invasao.pdf', contentType: 'application/pdf' }), mensagem: 'Curso não encontrado.' },
    ]

    for (const r of rotas) {
      it(`${r.metodo.toUpperCase()} ${r.rota}`, async () => {
        const alvo = await novoAlvo()
        const res = await chamar(r.metodo, w.a.host, w.u.adminA, r.caminho(alvo), r.corpo?.(alvo))
        expect(res.status).toBe(404)
        // a mensagem prova que o 404 veio do escopo do polo, e não de rota inexistente
        expect(res.body.message).toBe(r.mensagem)
        await intacto(alvo)
      })
    }
  })

  describe('o instrutor percorre a autoria inteira no próprio polo', () => {
    it('curso, módulos, aulas, anexos, reordenação, revisão e exclusão em cascata', async () => {
      const eu = (metodo: Metodo, caminho: string, corpo?: object) => chamar(metodo, w.a.host, w.u.teacherA, caminho, corpo)

      const criado = await eu('post', '/courses', { title: 'Fluxo Completo' })
      expect(criado.status).toBe(201)
      const cursoId = criado.body.course.id as string

      const mod = await eu('post', `/courses/${cursoId}/modules`, { title: 'Módulo 1' })
      expect(mod.status).toBe(201)
      const modId = mod.body.id as string
      const l1 = (await eu('post', `/modules/${modId}/lessons`, { title: 'Aula 1' })).body.id as string
      const l2 = (await eu('post', `/modules/${modId}/lessons`, { title: 'Aula 2' })).body.id as string
      expect((await eu('put', `/modules/${modId}/lessons/reorder`, { orderedIds: [l2, l1] })).status).toBe(200)

      // vídeo do próprio curso passa; vídeo do prefixo de outro curso é barrado
      expect((await eu('patch', `/lessons/${l1}`, { title: 'Aula 1 editada', videoUrl: `cursos/${cursoId}/video/aula1.mp4` })).status).toBe(200)
      expect((await eu('patch', `/lessons/${l1}`, { videoUrl: `cursos/${w.courses.b.id}/video/roubado.mp4` })).status).toBe(403)

      const anexo = await eu('post', `/lessons/${l1}/attachments`, { fileName: 'apostila.pdf', fileUrl: `cursos/${cursoId}/attachment/apostila.pdf` })
      expect(anexo.status).toBe(201)
      expect((await eu('patch', `/modules/${modId}/release`, { availableAt: '2037-01-01T00:00:00.000Z' })).status).toBe(200)
      expect((await eu('patch', `/modules/${modId}`, { title: 'Módulo 1 editado' })).status).toBe(200)
      expect((await eu('put', `/courses/${cursoId}/modules/reorder`, { orderedIds: [modId] })).status).toBe(200)

      const detalhe = await eu('get', `/courses/${cursoId}`)
      expect(detalhe.status).toBe(200)
      const modulo = detalhe.body.modules[0]
      expect(modulo.title).toBe('Módulo 1 editado')
      expect(new Date(modulo.availableAt).getTime()).toBe(Date.parse('2037-01-01T00:00:00.000Z'))
      expect(modulo.lessons.map((l: { id: string }) => l.id)).toEqual([l2, l1])
      expect(modulo.lessons[1]).toMatchObject({ title: 'Aula 1 editada', videoUrl: `cursos/${cursoId}/video/aula1.mp4` })
      expect(modulo.lessons[1].attachments).toEqual([
        { id: anexo.body.id, fileName: 'apostila.pdf', url: `https://gcs.fake/cursos/${cursoId}/attachment/apostila.pdf` },
      ])
      expect((await eu('get', `/courses/${cursoId}/meta`)).body.course).toMatchObject({ id: cursoId, moduleCount: 1, lessonCount: 2 })

      // o instrutor envia o próprio curso para revisão
      const revisao = await eu('patch', `/courses/${cursoId}/status`, { status: 'in_review' })
      expect(revisao.status).toBe(200)
      expect(revisao.body.status).toBe('in_review')

      // remoção pontual: anexo, aula e um segundo módulo
      expect((await eu('delete', `/attachments/${anexo.body.id}`)).status).toBe(200)
      expect((await eu('delete', `/lessons/${l2}`)).status).toBe(200)
      const extra = await eu('post', `/courses/${cursoId}/modules`, { title: 'Módulo extra' })
      expect((await eu('delete', `/modules/${extra.body.id}`)).status).toBe(200)
      expect(await contar('lessons', 'module_id', modId)).toBe(1)
      expect(await contar('lesson_attachments', 'lesson_id', l1)).toBe(0)

      // e a exclusão do curso leva o que sobrou
      await eu('post', `/lessons/${l1}/attachments`, { fileName: 'outra.pdf', fileUrl: `cursos/${cursoId}/attachment/outra.pdf` })
      expect(await contar('lesson_attachments', 'lesson_id', l1)).toBe(1)
      expect((await eu('delete', `/courses/${cursoId}`)).status).toBe(200)
      expect(await contar('courses', 'id', cursoId)).toBe(0)
      expect(await contar('modules', 'course_id', cursoId)).toBe(0)
      expect(await contar('lessons', 'module_id', modId)).toBe(0)
      expect(await contar('lesson_attachments', 'lesson_id', l1)).toBe(0)
    })
  })

  describe('exclusão de curso: o que tem história não se apaga', () => {
    // Curso aprovado, com aluno ou com certificado tem história: o polo tira do ar ou arquiva. O certificado é registro
    // do Studio Pilari (a verificação pelo QR continua valendo), então nem a plataforma apaga curso que tem um.
    const HISTORIA_POLO = 'Este curso já foi aprovado ou tem alunos e não pode ser excluído. Tire o curso do ar.'
    const HISTORIA_PLATAFORMA = 'Este curso tem certificados emitidos e não pode ser excluído. Tire o curso do ar.'
    let seqExclusao = 0
    const novoCurso = async (input: { status?: CourseStatus; approved?: boolean } = {}) => {
      seqExclusao += 1
      return seedCourse(t, {
        tenantId: w.a.id, slug: `exclusao-${seqExclusao}`, title: `Curso para Excluir ${seqExclusao}`, instructorId: w.u.teacherA,
        status: input.status ?? 'draft', approved: input.approved,
      })
    }
    /** Certificado emitido para o aluno no curso (sem matrícula: só o certificado já basta para barrar). */
    const certificar = async (courseId: string, uid: string): Promise<string> => {
      const codigo = randomBytes(16).toString('hex').toUpperCase()
      await t.pool.query(
        'INSERT INTO certificates (id, user_id, course_id, code, student_name, course_title, hours, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [randomUUID(), uid, courseId, codigo, 'Aluna A', 'Curso Certificado', 10, 'issued']
      )
      return codigo
    }
    const excluir = (host: string, uid: string, id: string) => chamar('delete', host, uid, `/courses/${id}`)
    const existe = async (id: string) => (await contar('courses', 'id', id)) === 1
    const exclusoesNoLog = (id: string) =>
      eventually(
        async () => (await t.pool.query("SELECT tenant_id, actor_uid, summary FROM audit_logs WHERE action = 'course.delete' AND target_id = ?", [id]))[0] as Array<Record<string, unknown>>,
        (v) => v.length > 0
      )

    it('o polo (admin e instrutor dono) recebe 409 em curso aprovado, com matrícula ou com certificado, e o certificado continua válido', async () => {
      const aprovado = await novoCurso({ status: 'draft', approved: true })
      const comMatricula = await novoCurso()
      await seedEnrollment(t, { userId: w.u.studentA, courseId: comMatricula.id })
      const comCertificado = await novoCurso()
      const codigo = await certificar(comCertificado.id, w.u.studentA)

      for (const c of [aprovado, comMatricula, comCertificado]) {
        for (const uid of [w.u.adminA, w.u.teacherA]) {
          const r = await excluir(w.a.host, uid, c.id)
          expect([c.slug, uid, r.status, r.body.code, r.body.message]).toEqual([c.slug, uid, 409, 'COURSE_HAS_HISTORY', HISTORIA_POLO])
        }
        expect(await existe(c.id)).toBe(true)
      }
      expect(await contar('enrollments', 'course_id', comMatricula.id)).toBe(1)
      expect(await contar('certificates', 'course_id', comCertificado.id)).toBe(1)
      const verificacao = await app.http().get(`/api/certificates/${codigo}/verify`).set('Host', w.matriz.host)
      expect(verificacao.body).toMatchObject({ valid: true, hasDocument: true, poloName: 'Polo A' })
    })

    it('rascunho sem nada é excluído e a exclusão fica no log do polo, com o título do curso', async () => {
      const c = await novoCurso()
      expect((await excluir(w.a.host, w.u.teacherA, c.id)).status).toBe(200)
      expect(await existe(c.id)).toBe(false)
      expect(await exclusoesNoLog(c.id)).toEqual([{ tenant_id: w.a.id, actor_uid: w.u.teacherA, summary: `Excluiu o curso "Curso para Excluir ${seqExclusao}"` }])
    })

    it('a plataforma exclui curso aprovado sem certificado (mesmo com aluno, como antes) e recebe 409 no que tem certificado', async () => {
      const semCertificado = await novoCurso({ status: 'published' })
      await seedEnrollment(t, { userId: w.u.studentA, courseId: semCertificado.id })
      expect((await excluir(w.a.host, w.u.platform, semCertificado.id)).status).toBe(200)
      expect(await existe(semCertificado.id)).toBe(false)
      expect(await contar('enrollments', 'course_id', semCertificado.id)).toBe(0)
      expect(await exclusoesNoLog(semCertificado.id)).toEqual([
        { tenant_id: w.a.id, actor_uid: w.u.platform, summary: `Excluiu o curso "Curso para Excluir ${seqExclusao}"` },
      ])

      const comCertificado = await novoCurso({ status: 'published' })
      const codigo = await certificar(comCertificado.id, w.u.studentA)
      const negado = await excluir(w.a.host, w.u.platform, comCertificado.id)
      expect([negado.status, negado.body.code, negado.body.message]).toEqual([409, 'COURSE_HAS_HISTORY', HISTORIA_PLATAFORMA])
      expect(await existe(comCertificado.id)).toBe(true)
      expect((await app.http().get(`/api/certificates/${codigo}/verify`).set('Host', w.a.host)).body.valid).toBe(true)
    })

    it('corrida: a aprovação que chega enquanto o polo exclui espera a trava da linha do curso, e a exclusão vê a história (409, nada apagado)', async () => {
      const c = await novoCurso() // rascunho nunca aprovado, sem aluno nem certificado: excluível até a aprovação chegar
      const outra = await t.pool.getConnection()
      try {
        // Outra transação (a aprovação) segura a linha do curso enquanto a exclusão começa.
        await outra.query('START TRANSACTION')
        await outra.query('SELECT id FROM courses WHERE id = ? FOR UPDATE', [c.id])
        const resposta = excluir(w.a.host, w.u.teacherA, c.id).then((r) => r)
        // a exclusão fica esperando a trava da linha
        await eventually(
          async () => esperasDeLock(t.pool),
          (n) => n > 0,
          10_000 // em máquina carregada a requisição pode demorar a chegar na trava
        )
        await outra.query('UPDATE courses SET approved_at = NOW(3) WHERE id = ?', [c.id])
        await outra.query('COMMIT')
        const r = await resposta
        expect([r.status, r.body.code, r.body.message]).toEqual([409, 'COURSE_HAS_HISTORY', HISTORIA_POLO])
        expect(await existe(c.id)).toBe(true)
        // e a cascata não começou: módulo e aula continuam lá
        expect(await contar('modules', 'course_id', c.id)).toBe(1)
        expect(await contar('lessons', 'module_id', c.moduleId)).toBe(1)
      } finally {
        outra.release()
      }
    })
  })

  describe('capa do curso: só imagem enviada para a capa deste curso, ou link', () => {
    const CAPA_INVALIDA = { statusCode: 400, code: 'INVALID_COVER_PATH', message: 'A capa precisa ser uma imagem enviada pelo editor deste curso ou um link http(s).' }
    let curso: string
    const grava = (coverImageUrl: string | null) => chamar('patch', w.a.host, w.u.teacherA, `/courses/${curso}`, { coverImageUrl })
    const capaNoBanco = async () => ((await t.pool.query('SELECT cover_image_url AS capa FROM courses WHERE id = ?', [curso]))[0] as Array<{ capa: string | null }>)[0].capa

    beforeAll(async () => {
      curso = (await seedCourse(t, { tenantId: w.a.id, slug: 'capa-a', title: 'Curso da Capa', instructorId: w.u.teacherA, status: 'draft' })).id
    })

    it('vídeo, anexo ou rubrica do próprio curso não viram capa: 400 e nada é gravado', async () => {
      for (const pasta of ['video/aula1.mp4', 'attachment/apostila.pdf', 'signature/rubrica.png', 'capa.png']) {
        const r = await grava(`cursos/${curso}/${pasta}`)
        expect([pasta, r.status, r.body]).toEqual([pasta, 400, CAPA_INVALIDA])
      }
      expect(await capaNoBanco()).toBeNull()
    })

    it('a imagem da pasta cover do curso, um link http(s) e a remoção passam', async () => {
      for (const valor of [`cursos/${curso}/cover/${randomUUID()}-capa.png`, 'https://img.exemplo.com/capa.png', null]) {
        const r = await grava(valor)
        expect([valor, r.status]).toEqual([valor, 200])
        expect(await capaNoBanco()).toBe(valor)
      }
    })

    it('valor antigo fora da pasta cover fica como está: o formulário inteiro continua salvando', async () => {
      const antigo = `cursos/${curso}/video/capa-antiga.png`
      await t.pool.query('UPDATE courses SET cover_image_url = ? WHERE id = ?', [antigo, curso])
      const r = await chamar('patch', w.a.host, w.u.teacherA, `/courses/${curso}`, { coverImageUrl: antigo, subtitle: 'Novo subtítulo' })
      expect(r.status).toBe(200)
      expect(await capaNoBanco()).toBe(antigo)
      // mas trocar por outro caminho fora da pasta cover continua barrado
      expect((await grava(`cursos/${curso}/video/outra.png`)).status).toBe(400)
    })
  })

  describe('rastro de mudança em curso aprovado', () => {
    // Depois da aprovação, o que muda no curso fica no log do polo: exclusão de módulo, de aula e de questão de prova,
    // a duração das aulas (de onde sai a carga quando ela é calculada) e, pela plataforma, os dados do certificado.
    let seqRastro = 0
    const cursoComProva = async (aprovado: boolean) => {
      seqRastro += 1
      const title = `Curso Rastreado ${seqRastro}`
      const c = await seedCourse(t, {
        tenantId: w.a.id, slug: `rastro-${seqRastro}`, title, instructorId: w.u.teacherA, status: aprovado ? 'published' : 'draft', approved: aprovado,
      })
      const aula2 = randomUUID()
      await t.db.insert(lessons).values({ id: aula2, moduleId: c.moduleId, title: 'Aula 2', durationSec: 300, order: 1, isFreePreview: false })
      const modulo2 = randomUUID()
      await t.db.insert(modules).values({ id: modulo2, courseId: c.id, title: 'Módulo 2', order: 1 })
      const questao = randomUUID()
      await t.db.insert(quizQuestions).values({ id: questao, moduleId: c.moduleId, prompt: 'Quanto é 1 + 1?', options: ['1', '2'], correctIndex: 1, order: 0 })
      return { ...c, title, aula2, modulo2, questao }
    }
    const logsDoCurso = async (id: string) =>
      (await t.pool.query('SELECT tenant_id, actor_uid, action, summary FROM audit_logs WHERE target_id = ? ORDER BY action', [id]))[0] as Array<Record<string, unknown>>
    /** Mexe no curso como o instrutor dono: edições que não contam, a duração de uma aula e três exclusões. */
    const mexer = async (c: Awaited<ReturnType<typeof cursoComProva>>) => {
      const eu = (metodo: Metodo, caminho: string, corpo?: object) => chamar(metodo, w.a.host, w.u.teacherA, caminho, corpo)
      expect((await eu('patch', `/lessons/${c.lessonId}`, { title: 'Aula 1 revista' })).status).toBe(200) // sem duração: não conta
      expect((await eu('patch', `/lessons/${c.lessonId}`, { durationSec: 600 })).status).toBe(200) // a mesma duração: não conta
      expect((await eu('patch', `/lessons/${c.lessonId}`, { durationSec: 900 })).status).toBe(200)
      expect((await eu('delete', `/lessons/${c.aula2}`)).status).toBe(200)
      expect((await eu('delete', `/questions/${c.questao}`)).status).toBe(200)
      expect((await eu('delete', `/modules/${c.modulo2}`)).status).toBe(200)
    }

    it('exclusões de módulo, aula e questão e a mudança de duração da aula vão para o log do polo, com o título do curso', async () => {
      const c = await cursoComProva(true)
      await mexer(c)
      const logs = await eventually(() => logsDoCurso(c.id), (v) => v.length >= 4)
      expect(logs).toEqual([
        { tenant_id: w.a.id, actor_uid: w.u.teacherA, action: 'course.lesson-delete', summary: `Curso "${c.title}": excluiu a aula "Aula 2"` },
        { tenant_id: w.a.id, actor_uid: w.u.teacherA, action: 'course.lesson-duration', summary: `Curso "${c.title}": duração da aula "Aula 1 revista" de 10 min → 15 min` },
        { tenant_id: w.a.id, actor_uid: w.u.teacherA, action: 'course.module-delete', summary: `Curso "${c.title}": excluiu o módulo "Módulo 2"` },
        {
          tenant_id: w.a.id, actor_uid: w.u.teacherA, action: 'course.question-delete',
          summary: `Curso "${c.title}": excluiu a questão "Quanto é 1 + 1?" da prova do módulo "Módulo 1"`,
        },
      ])
    })

    it('curso nunca aprovado não grava nada disso', async () => {
      const rascunho = await cursoComProva(false)
      await mexer(rascunho)
      // marcador: a exclusão de aula num curso aprovado é gravada; quando ela aparece, a do rascunho já teria aparecido
      const aprovado = await cursoComProva(true)
      expect((await chamar('delete', w.a.host, w.u.teacherA, `/lessons/${aprovado.aula2}`)).status).toBe(200)
      await eventually(() => logsDoCurso(aprovado.id), (v) => v.length > 0)
      expect(await logsDoCurso(rascunho.id)).toEqual([])
    })

    it('a plataforma muda dados do certificado de curso aprovado: o log do polo lista os campos mudados', async () => {
      const c = await cursoComProva(true)
      const plataforma = (corpo: object) => chamar('patch', w.a.host, w.u.platform, `/courses/${c.id}`, corpo)
      expect((await plataforma({ title: c.title, description: 'Só a descrição' })).status).toBe(200) // nada travado mudou
      expect((await plataforma({ title: 'Título Corrigido', workloadHours: 60, description: 'Só a descrição' })).status).toBe(200)
      const logs = await eventually(() => logsDoCurso(c.id), (v) => v.length > 0)
      expect(logs).toEqual([
        { tenant_id: w.a.id, actor_uid: w.u.platform, action: 'course.locked-fields', summary: `Curso "${c.title}": o Studio Pilari alterou o título e a carga horária` },
      ])
    })
  })

  describe('rubrica do coordenador presa ao próprio curso', () => {
    // A rubrica é lida do bucket com a service account (rota /signature e emissão do diploma). O admin do
    // polo A edita o coordenador do próprio curso, então o caminho que ele grava não pode apontar para
    // objeto de outro curso, e a rota não pode servir um caminho que já esteja gravado fora do curso.
    type LeituraGcs = { readObject(caminho?: string | null): Promise<{ buffer: Buffer; contentType: string } | null> }
    let curso: string
    let leitura: jest.SpyInstance

    const rubricaDoB = () => `cursos/${w.courses.b.id}/signature/rubrica-do-b.png`
    const grava = (corpo: object) => chamar('patch', w.a.host, w.u.adminA, `/courses/${curso}`, corpo)
    const rubrica = () => chamar('get', w.a.host, w.u.adminA, `/courses/${curso}/signature`)
    const noBanco = (coluna: string, valor: string | null) =>
      t.pool.query(`UPDATE courses SET ${coluna} = ? WHERE id = ?`, [valor, curso])

    beforeAll(async () => {
      // rascunho do polo A, nunca aprovado: a trava dos dados do certificado não entra nestes testes
      curso = (await seedCourse(t, { tenantId: w.a.id, slug: 'rubrica-a', title: 'Curso da Rubrica', instructorId: w.u.teacherA, status: 'draft' })).id
    })
    // O GCS falso nunca devolve objeto. Este spy devolve bytes para QUALQUER caminho, então a rota só
    // responde 404 se ela mesma se recusar a ler; sem ele o teste passaria até com a rota aberta.
    beforeEach(() => {
      leitura = jest
        .spyOn(app.fakes.gcs as unknown as LeituraGcs, 'readObject')
        .mockResolvedValue({ buffer: Buffer.from('bytes-da-rubrica'), contentType: 'image/png' })
    })
    afterEach(() => {
      leitura.mockRestore()
    })

    it('o admin do polo A não grava, no próprio curso, a rubrica de um curso do polo B (mesmo erro da capa)', async () => {
      const capa = await grava({ coverImageUrl: `cursos/${w.courses.b.id}/cover/capa-do-b.png` })
      const alheia = await grava({ coordinatorName: 'Fulano', coordinatorSignaturePath: rubricaDoB() })
      expect(capa.status).toBe(403)
      expect(alheia.status).toBe(capa.status)
      expect(alheia.body.message).toBe(capa.body.message)
      // o save inteiro foi recusado: nem o nome do coordenador foi gravado
      const [rows] = await t.pool.query('SELECT coordinator_name AS nome, coordinator_signature_path AS rubrica FROM courses WHERE id = ?', [curso])
      expect(rows).toEqual([{ nome: null, rubrica: null }])
    })

    it('a rubrica do próprio curso, o mesmo valor de novo (formulário inteiro) e a remoção passam', async () => {
      const propria = `cursos/${curso}/signature/${randomUUID()}-rubrica.png`
      const salva = await grava({ coordinatorName: 'Ana', coordinatorSignaturePath: propria })
      expect(salva.status).toBe(200)
      expect(salva.body.course.coordinatorSignaturePath).toBe(propria)
      expect((await grava({ coordinatorName: 'Ana', coordinatorSignaturePath: propria })).status).toBe(200)
      const limpa = await grava({ coordinatorName: null, coordinatorSignaturePath: null })
      expect(limpa.status).toBe(200)
      expect(limpa.body.course.coordinatorSignaturePath).toBeNull()
    })

    it('a rota serve a rubrica que está dentro de cursos/<id>/', async () => {
      const propria = `cursos/${curso}/signature/rubrica.png`
      await noBanco('coordinator_signature_path', propria)
      const r = await rubrica()
      expect(r.status).toBe(200)
      expect(r.headers['content-type']).toContain('image/png')
      expect(r.headers['cache-control']).toBe('no-store')
      // com o teto de imagem: um arquivo gigante no lugar da rubrica não é carregado na memória
      expect(leitura).toHaveBeenCalledWith(propria, { maxBytes: 5 * 1024 * 1024 })
    })

    it('a rota não serve caminho fora de cursos/<id>/, mesmo já gravado no banco: 404 sem nem ler o bucket', async () => {
      const ruins: Array<[string, string]> = [
        ['objeto de um curso do polo B', rubricaDoB()],
        ['fora de cursos/', 'assinaturas/diretora.png'],
        ['prefixo parecido, sem a barra', `cursos/${curso}-outro/signature/x.png`],
        ['URL externa', 'https://exemplo.com/rubrica.png'],
      ]
      for (const [quem, caminho] of ruins) {
        await noBanco('coordinator_signature_path', caminho)
        const r = await rubrica()
        expect([quem, r.status, r.text]).toEqual([quem, 404, 'Sem rubrica'])
      }
      expect(leitura).not.toHaveBeenCalled()
    })

    it('legado de outro curso gravado antes da trava: o formulário inteiro ainda salva, a rota continua sem servi-lo e trocar por outro caminho alheio segue barrado', async () => {
      const legado = rubricaDoB()
      await noBanco('coordinator_name', 'Ana')
      await noBanco('coordinator_signature_path', legado)
      const salva = await grava({ subtitle: 'ajuste do admin', coordinatorName: 'Ana', coordinatorSignaturePath: legado })
      expect(salva.status).toBe(200)
      expect(salva.body.course.subtitle).toBe('ajuste do admin')
      expect((await rubrica()).status).toBe(404)
      expect(leitura).not.toHaveBeenCalled()
      expect((await grava({ coordinatorSignaturePath: `cursos/${w.courses.matriz.id}/signature/outra.png` })).status).toBe(403)
      await noBanco('coordinator_name', null)
      await noBanco('coordinator_signature_path', null)
    })
  })
})
