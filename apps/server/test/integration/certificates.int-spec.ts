import { randomUUID } from 'node:crypto'
import { bootTestApp, type TestApp } from './helpers/app'
import { createTestDatabase, type TestDatabase } from './helpers/db'
import { bearer, seedCourse, seedOrder, seedTwoPolos, type TwoPolos } from './helpers/seed'
import { eventually } from './helpers/wait'

const CODIGO_A = 'A0000000000000000000000000000001'
const CODIGO_M = 'B0000000000000000000000000000002'
/** Certificado do aluno do B no curso do B: o dos testes da rubrica, que mexem nele. */
const CODIGO_B = 'C0000000000000000000000000000003'

describe('certificados por polo', () => {
  let t: TestDatabase
  let app: TestApp
  let w: TwoPolos
  let pedidoMatriz: string

  beforeAll(async () => {
    t = await createTestDatabase()
    app = await bootTestApp(t.url)
    w = await seedTwoPolos(t)
    const insere = 'INSERT INTO certificates (id, user_id, course_id, code, student_name, course_title, hours, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    await t.pool.query(insere, [randomUUID(), w.u.studentA, w.courses.a.id, CODIGO_A, 'Aluna A', 'Excel do Polo A', 40, 'issued'])
    await t.pool.query(insere, [randomUUID(), w.u.adminMatriz, w.courses.matriz.id, CODIGO_M, 'Admin M', 'Excel da Matriz', 40, 'issued'])
    pedidoMatriz = await seedOrder(t, { tenantId: w.matriz.id, userId: w.u.shared })
  })
  afterAll(async () => {
    try {
      await app?.close()
    } finally {
      await t?.drop()
    }
  })

  it('a verificação funciona de qualquer endereço e mostra o polo', async () => {
    for (const host of [w.matriz.host, w.b.host]) {
      const r = await app.http().get(`/api/certificates/${CODIGO_A}/verify`).set('Host', host)
      expect(r.body).toMatchObject({ valid: true, poloName: 'Polo A' })
    }
    expect((await app.http().get(`/api/certificates/${CODIGO_M}/verify`).set('Host', w.matriz.host)).body.poloName).toBeNull()
  })

  it('a lista de certificados do aluno é a do polo do endereço', async () => {
    const a = await app.http().get('/api/me/certificates').set('Host', w.a.host).set('Authorization', bearer(w.u.studentA))
    const b = await app.http().get('/api/me/certificates').set('Host', w.b.host).set('Authorization', bearer(w.u.studentA))
    expect((a.body as unknown[]).length).toBe(1)
    expect(b.body).toEqual([])
  })

  it('emissão sem requisitos é só da plataforma', async () => {
    const url = `/api/admin/students/${w.u.studentA}/courses/${w.courses.a.id}/certificate`
    expect((await app.http().post(url).set('Host', w.a.host).set('Authorization', bearer(w.u.adminA)).send({})).status).toBe(403)
    const r = await app.http().post(url).set('Host', w.a.host).set('Authorization', bearer(w.u.platform)).send({})
    expect(r.status).toBe(201)
    expect(r.headers['content-type']).toContain('application/pdf')
  })

  it('modelos de certificado são só da plataforma (o admin da matriz é da plataforma)', async () => {
    expect((await app.http().get('/api/admin/certificate-template').set('Host', w.a.host).set('Authorization', bearer(w.u.adminA))).status).toBe(403)
    expect((await app.http().get('/api/admin/certificate-template').set('Host', w.matriz.host).set('Authorization', bearer(w.u.adminA))).status).toBe(403)
    expect((await app.http().get('/api/admin/certificate-template').set('Host', w.matriz.host).set('Authorization', bearer(w.u.adminMatriz))).status).toBe(200)
    expect((await app.http().get('/api/admin/certificate-template').set('Host', w.matriz.host).set('Authorization', bearer(w.u.platform))).status).toBe(200)
  })

  it('carnê de pedido de outro polo responde 404', async () => {
    const r = await app.http().get(`/api/me/orders/${pedidoMatriz}/carne`).set('Host', w.a.host).set('Authorization', bearer(w.u.shared))
    expect(r.status).toBe(404)
  })

  // Os cinco testes de cima são os do enunciado e dependem do estado semeado (a aluna A com um só
  // certificado, nenhum modelo cadastrado). Os de baixo gravam por cima disso, por isso vêm depois.

  const como = (host: string, uid: string) => ({ Host: host, Authorization: bearer(uid) })
  /** Cursos dos certificados do aluno (de qualquer polo), em ordem estável. */
  const cursosCertificados = async (uid: string): Promise<string[]> => {
    const [rows] = await t.pool.query('SELECT course_id FROM certificates WHERE user_id = ?', [uid])
    return (rows as Array<{ course_id: string }>).map((r) => r.course_id).sort()
  }

  describe('verificação e documento públicos', () => {
    it('código que não existe: inválido, sem documento e sem polo', async () => {
      const r = await app.http().get('/api/certificates/ZZZ-NAO-EXISTE/verify').set('Host', w.b.host)
      expect(r.status).toBe(200)
      expect(r.body).toEqual({ valid: false, studentName: null, courseTitle: null, issuedAt: null, hasDocument: false, poloName: null })
    })

    it('o código vale em minúsculas e mostra o curso e o aluno do certificado', async () => {
      const r = await app.http().get(`/api/certificates/${CODIGO_A.toLowerCase()}/verify`).set('Host', w.a.host)
      expect(r.body).toMatchObject({ valid: true, courseTitle: 'Excel do Polo A', hasDocument: true, poloName: 'Polo A' })
    })

    it('o PDF do código abre de qualquer endereço (o do QR não depende do polo)', async () => {
      for (const host of [w.matriz.host, w.a.host, w.b.host]) {
        const r = await app.http().get(`/api/certificates/${CODIGO_A}/document`).set('Host', host)
        expect([host, r.status]).toEqual([host, 200])
        expect(r.headers['content-type']).toContain('application/pdf')
      }
    })
  })

  describe('o aluno compartilhado emite e lista em cada endereço', () => {
    beforeAll(async () => {
      // concluiu a única aula do curso `excel-basico`, no A e no B
      for (const curso of [w.courses.a, w.courses.b]) {
        await t.pool.query('INSERT INTO lesson_progress (id, user_id, lesson_id, completed, completed_at) VALUES (?, ?, ?, 1, NOW())', [randomUUID(), w.u.shared, curso.lessonId])
      }
    })

    it('o mesmo slug emite o certificado do curso do polo do endereço, nunca o de outro', async () => {
      const noA = await app.http().get('/api/me/courses/excel-basico/certificate').query({ cpf: '52998224725' }).set(como(w.a.host, w.u.shared))
      expect(noA.status).toBe(200)
      expect(noA.headers['content-type']).toContain('application/pdf')
      expect(await cursosCertificados(w.u.shared)).toEqual([w.courses.a.id])

      const noB = await app.http().get('/api/me/courses/excel-basico/certificate').query({ cpf: '52998224725' }).set(como(w.b.host, w.u.shared))
      expect(noB.status).toBe(200)
      expect(await cursosCertificados(w.u.shared)).toEqual([w.courses.a.id, w.courses.b.id].sort())
      // e o curso da matriz, que tem o MESMO slug, nunca é tocado
      expect(await cursosCertificados(w.u.shared)).not.toContain(w.courses.matriz.id)
    })

    it('a lista de cada endereço mostra só o certificado do próprio polo', async () => {
      const lista = async (host: string) => {
        const r = await app.http().get('/api/me/certificates').set(como(host, w.u.shared))
        expect(r.status).toBe(200)
        return r.body as Array<{ courseSlug: string; courseTitle: string }>
      }
      expect(await lista(w.a.host)).toEqual([expect.objectContaining({ courseSlug: 'excel-basico', courseTitle: 'Excel do Polo A' })])
      expect(await lista(w.b.host)).toEqual([expect.objectContaining({ courseSlug: 'excel-basico', courseTitle: 'Excel do Polo B' })])
      expect(await lista(w.matriz.host)).toEqual([])
    })

    it('o aluno do A não emite pelo endereço do B: o curso de mesmo slug é outro e ele não está matriculado', async () => {
      const r = await app.http().get('/api/me/courses/excel-basico/certificate').query({ cpf: '52998224725' }).set(como(w.b.host, w.u.studentA))
      expect(r.status).toBe(403)
      // continua só com o certificado semeado, o do curso do A
      expect(await cursosCertificados(w.u.studentA)).toEqual([w.courses.a.id])
    })
  })

  describe('status de quitação e carnê', () => {
    beforeAll(async () => {
      await seedCourse(t, { tenantId: w.b.id, slug: 'so-no-b', title: 'Só no B', instructorId: w.u.teacherB })
    })

    it('o status é o do curso do polo do endereço', async () => {
      const url = '/api/me/courses/excel-basico/certificate/status'
      const noA = await app.http().get(url).set(como(w.a.host, w.u.studentA))
      expect(noA.status).toBe(200)
      // matrícula de cortesia: nunca há carnê a quitar
      expect(noA.body).toEqual({ settled: true, paidCount: 0, totalCount: 0, carneUrl: null })
      // no B existe um curso com o mesmo slug, mas o aluno do A não está nele
      expect((await app.http().get(url).set(como(w.b.host, w.u.studentA))).status).toBe(403)
    })

    it('slug que só existe em outro polo, ou em rascunho, responde 404 no status e na emissão', async () => {
      for (const [host, slug] of [[w.a.host, 'so-no-b'], [w.a.host, 'rascunho-a']] as const) {
        const status = await app.http().get(`/api/me/courses/${slug}/certificate/status`).set(como(host, w.u.studentA))
        const emissao = await app.http().get(`/api/me/courses/${slug}/certificate`).query({ cpf: '52998224725' }).set(como(host, w.u.studentA))
        expect([slug, status.status, emissao.status]).toEqual([slug, 404, 404])
      }
    })

    it('o carnê é do pedido do polo do endereço e do próprio aluno', async () => {
      const pedidoA = await seedOrder(t, { tenantId: w.a.id, userId: w.u.shared })
      await t.pool.query('UPDATE orders SET asaas_installment_id = ? WHERE id = ?', ['ins_fake', pedidoA])
      const url = `/api/me/orders/${pedidoA}/carne`

      const noA = await app.http().get(url).set(como(w.a.host, w.u.shared))
      expect(noA.status).toBe(200)
      expect(noA.headers['content-type']).toContain('application/pdf')
      // o MESMO aluno, pelo endereço de outro polo: o pedido não existe ali
      expect((await app.http().get(url).set(como(w.b.host, w.u.shared))).status).toBe(404)
      // outro aluno do mesmo polo: também não é dele
      expect((await app.http().get(url).set(como(w.a.host, w.u.studentA))).status).toBe(404)
    })
  })

  describe('emissão sem requisitos', () => {
    it('a plataforma emite pelo endereço do polo e a ação fica auditada nesse polo', async () => {
      const r = await app.http().post(`/api/admin/students/${w.u.studentA}/courses/${w.courses.a.id}/certificate`).set(como(w.a.host, w.u.platform)).send({})
      expect(r.status).toBe(201)
      const rows = await eventually(
        async () => (await t.pool.query("SELECT tenant_id, actor_uid FROM audit_logs WHERE action = 'certificate.issue_admin' AND target_id = ?", [w.u.studentA]))[0] as Array<{ tenant_id: string; actor_uid: string }>,
        (v) => v.length > 0
      )
      expect(rows.length).toBeGreaterThan(0)
      for (const linha of rows) expect(linha).toEqual({ tenant_id: w.a.id, actor_uid: w.u.platform })
    })

    it('a equipe do próprio polo recebe 403 e o admin da matriz (plataforma) pelo endereço da matriz recebe 404, e nada é emitido', async () => {
      const url = `/api/admin/students/${w.u.studentB}/courses/${w.courses.b.id}/certificate`
      const antes = await cursosCertificados(w.u.studentB)
      const respostas = [
        (await app.http().post(url).set(como(w.b.host, w.u.adminB)).send({})).status,
        (await app.http().post(url).set(como(w.matriz.host, w.u.adminMatriz)).send({})).status,
        (await app.http().post(url).set(como(w.b.host, w.u.teacherB)).send({})).status,
        (await app.http().post(url).set(como(w.b.host, w.u.studentB)).send({})).status,
      ]
      // O admin da matriz é da plataforma: passa o @PlatformAdmin, mas o curso é de outro polo que não o do endereço.
      expect(respostas).toEqual([403, 404, 403, 403])
      expect(await cursosCertificados(w.u.studentB)).toEqual(antes)
    })

    it('o curso é o do endereço: id de curso de outro polo responde 404 até para a plataforma', async () => {
      const antes = await cursosCertificados(w.u.studentB)
      const r = await app.http().post(`/api/admin/students/${w.u.studentB}/courses/${w.courses.b.id}/certificate`).set(como(w.a.host, w.u.platform)).send({})
      expect(r.status).toBe(404)
      expect(await cursosCertificados(w.u.studentB)).toEqual(antes)
    })

    it('sem matrícula ativa no curso não há o que certificar (403), mesmo para a plataforma', async () => {
      const r = await app.http().post(`/api/admin/students/${w.u.studentB}/courses/${w.courses.a.id}/certificate`).set(como(w.a.host, w.u.platform)).send({ cpf: '52998224725' })
      expect(r.status).toBe(403)
    })
  })

  describe('modelos de certificado: só da plataforma, em qualquer endereço', () => {
    const base = '/api/admin/certificate-template'

    it('o admin do polo recebe 403 em TODAS as rotas e nada muda; a plataforma cria e vincula', async () => {
      const criado = await app.http().post(base).set(como(w.matriz.host, w.u.platform)).send({ name: 'Modelo da plataforma', html: '<html><body>modelo</body></html>' })
      expect(criado.status).toBe(201)
      const modeloId = criado.body.id as string

      const rotas: Array<['get' | 'post' | 'put' | 'delete', string, object?]> = [
        ['get', base],
        ['get', `${base}/novo`],
        ['get', `${base}/${modeloId}`],
        ['get', `${base}/${modeloId}/cursos`],
        ['post', base, { name: 'Intruso', html: '<html></html>' }],
        ['put', `${base}/${modeloId}`, { name: 'Renomeado' }],
        ['put', `${base}/${modeloId}/padrao`],
        ['delete', `${base}/${modeloId}`],
        ['post', `${base}/vincular`, { templateId: modeloId, courseIds: [w.courses.a.id] }],
        ['post', `${base}/preview`, { html: '<html></html>' }],
      ]
      const respostas: Array<[string, number]> = []
      for (const [metodo, caminho, corpo] of rotas) {
        const r = await app.http()[metodo](caminho).set(como(w.a.host, w.u.adminA)).send(corpo ?? {})
        respostas.push([`${metodo.toUpperCase()} ${caminho}`, r.status])
      }
      expect(respostas.filter(([, status]) => status !== 403)).toEqual([])

      // nada foi gravado: o curso do A segue sem modelo próprio, e o modelo da plataforma, intacto
      const [cursos] = await t.pool.query('SELECT certificate_template_id FROM courses WHERE id = ?', [w.courses.a.id])
      expect(cursos).toEqual([{ certificate_template_id: null }])
      const [modelos] = await t.pool.query('SELECT name FROM certificate_templates')
      expect(modelos).toEqual([{ name: 'Modelo da plataforma' }])

      // a plataforma, pelo endereço do polo, vincula o modelo ao curso dele
      const vinculo = await app.http().post(`${base}/vincular`).set(como(w.a.host, w.u.platform)).send({ templateId: modeloId, courseIds: [w.courses.a.id] })
      expect(vinculo.status).toBe(201)
      expect(vinculo.body).toEqual({ atualizados: 1 })
      const [depois] = await t.pool.query('SELECT certificate_template_id FROM courses WHERE id = ?', [w.courses.a.id])
      expect(depois).toEqual([{ certificate_template_id: modeloId }])
    })
  })

  // A rubrica do coordenador é lida do bucket com a service account (acesso ao bucket inteiro). O caminho
  // guardado — no snapshot congelado do certificado, no cadastro do curso — só vale sob
  // cursos/<id do curso do certificado>/. Fora disso o PDF sai com o nome do coordenador e SEM a imagem.
  describe('rubrica do coordenador: só se lê o objeto do prefixo do curso do certificado', () => {
    let propria: string
    let alheia: string
    const imagem = (conteudo: string) => `data:image/png;base64,${Buffer.from(conteudo).toString('base64')}`

    const rubricaCongelada = (caminho: string | null) =>
      t.pool.query('UPDATE certificates SET coordinator_signature_path = ? WHERE code = ?', [caminho, CODIGO_B])
    const rubricaDoCurso = (caminho: string | null) =>
      t.pool.query('UPDATE courses SET coordinator_signature_path = ? WHERE id = ?', [caminho, w.courses.b.id])
    const zera = () => {
      app.fakes.gcs.reads.length = 0
      app.fakes.pdf.calls.length = 0
    }
    const ultimoPdf = () => {
      const pdf = app.fakes.pdf.calls[app.fakes.pdf.calls.length - 1]
      expect(pdf).toBeDefined()
      return pdf
    }

    beforeAll(async () => {
      propria = `cursos/${w.courses.b.id}/signature/rubrica.png`
      alheia = `cursos/${w.courses.a.id}/signature/rubrica.png` // arquivo do curso do polo A
      app.fakes.gcs.objects.set(propria, { buffer: Buffer.from('RUBRICA-DO-B'), contentType: 'image/png' })
      app.fakes.gcs.objects.set(alheia, { buffer: Buffer.from('RUBRICA-DO-A'), contentType: 'image/png' })
      await t.pool.query(
        'INSERT INTO certificates (id, user_id, course_id, code, student_name, course_title, hours, coordinator_name, coordinator_role, coordinator_signature_path, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [randomUUID(), w.u.studentB, w.courses.b.id, CODIGO_B, 'Aluno B', 'Excel do Polo B', 40, 'Jane Veck', 'Coordenadora do Curso', alheia, 'issued']
      )
      await t.pool.query('UPDATE courses SET coordinator_name = ?, coordinator_role = ? WHERE id = ?', ['Jane Veck', 'Coordenadora do Curso', w.courses.b.id])
    })

    it('PDF público: a rubrica congelada de outro polo, ou de prefixo parecido, não é lida e o PDF sai só com o nome', async () => {
      // `parecida` começa por `cursos/<id do curso>` mas NÃO está dentro da pasta dele (falta a barra)
      const parecida = `cursos/${w.courses.b.id}-copia/signature/rubrica.png`
      app.fakes.gcs.objects.set(parecida, { buffer: Buffer.from('RUBRICA-PARECIDA'), contentType: 'image/png' })
      for (const caminho of [alheia, parecida]) {
        await rubricaDoCurso(null)
        await rubricaCongelada(caminho)
        zera()
        const r = await app.http().get(`/api/certificates/${CODIGO_B}/document`).set('Host', w.matriz.host)
        expect([caminho, r.status]).toEqual([caminho, 200])
        expect(app.fakes.gcs.reads).not.toContain(caminho)
        expect(ultimoPdf()).toMatchObject({ coordinatorName: 'Jane Veck', coordinatorRole: 'Coordenadora do Curso' })
        expect(ultimoPdf().coordinatorSignatureDataUri).toBeUndefined()
      }
    })

    it('PDF público: com o caminho do PRÓPRIO curso a imagem entra (a recusa acima não é um PDF que nunca leva imagem)', async () => {
      await rubricaDoCurso(null)
      await rubricaCongelada(propria)
      zera()
      const r = await app.http().get(`/api/certificates/${CODIGO_B}/document`).set('Host', w.matriz.host)
      expect(r.status).toBe(200)
      expect(app.fakes.gcs.reads).toContain(propria)
      expect(ultimoPdf().coordinatorSignatureDataUri).toBe(imagem('RUBRICA-DO-B'))
    })

    it('PDF público: a rubrica ATUAL do curso, se for de outro polo (legado), também não é lida', async () => {
      await rubricaCongelada(null)
      await rubricaDoCurso(alheia)
      zera()
      const r = await app.http().get(`/api/certificates/${CODIGO_B}/document`).set('Host', w.b.host)
      expect(r.status).toBe(200)
      expect(app.fakes.gcs.reads).not.toContain(alheia)
      expect(ultimoPdf()).toMatchObject({ coordinatorName: 'Jane Veck' })
      expect(ultimoPdf().coordinatorSignatureDataUri).toBeUndefined()
    })

    it('emissão pela plataforma: a rubrica congelada de outro polo não é lida; a do próprio curso substitui e é lida', async () => {
      const emite = () => app.http().post(`/api/admin/students/${w.u.studentB}/courses/${w.courses.b.id}/certificate`).set(como(w.b.host, w.u.platform)).send({})
      await rubricaDoCurso(null)
      await rubricaCongelada(alheia)
      zera()
      expect((await emite()).status).toBe(201)
      expect(app.fakes.gcs.reads).not.toContain(alheia)
      expect(ultimoPdf()).toMatchObject({ coordinatorName: 'Jane Veck' })
      expect(ultimoPdf().coordinatorSignatureDataUri).toBeUndefined()

      // o curso passa a ter a rubrica dele: a sincronização troca a congelada por ela, e só ela é lida
      await rubricaDoCurso(propria)
      zera()
      expect((await emite()).status).toBe(201)
      expect(app.fakes.gcs.reads).toContain(propria)
      expect(app.fakes.gcs.reads).not.toContain(alheia)
      expect(ultimoPdf().coordinatorSignatureDataUri).toBe(imagem('RUBRICA-DO-B'))
      const [rows] = await t.pool.query('SELECT coordinator_signature_path FROM certificates WHERE code = ?', [CODIGO_B])
      expect(rows).toEqual([{ coordinator_signature_path: propria }])
    })

    it('preview do modelo: a rubrica do curso previsto só é lida do prefixo dele', async () => {
      const preview = () =>
        app.http().post('/api/admin/certificate-template/preview').query({ courseId: w.courses.b.id }).set(como(w.matriz.host, w.u.platform)).send({ html: '<html><body>previa</body></html>' })

      await rubricaDoCurso(alheia)
      zera()
      expect((await preview()).status).toBe(201)
      expect(app.fakes.gcs.reads).not.toContain(alheia)
      expect(ultimoPdf()).toMatchObject({ coordinatorName: 'Jane Veck', coordinatorRole: 'Coordenadora do Curso' })
      expect(ultimoPdf().coordinatorSignatureDataUri).toBeUndefined()

      await rubricaDoCurso(propria)
      zera()
      expect((await preview()).status).toBe(201)
      expect(app.fakes.gcs.reads).toContain(propria)
      expect(ultimoPdf().coordinatorSignatureDataUri).toBe(imagem('RUBRICA-DO-B'))
    })
  })

  // O curso sai do ar depois que o aluno se formou: o certificado emitido continua dele (baixar e ver o status). Emitir
  // um certificado NOVO continua exigindo o curso publicado: o matriculado recebe o aviso, quem não é recebe 404.
  describe('curso fora do ar: o certificado já emitido continua com o titular', () => {
    const NO_POLO = 'Este curso está indisponível no momento. Fale com o seu polo.'
    let slug: string
    const emitir = (uid: string) => app.http().get(`/api/me/courses/${slug}/certificate`).query({ cpf: '52998224725' }).set(como(w.b.host, uid))
    const situacao = (uid: string) => app.http().get(`/api/me/courses/${slug}/certificate/status`).set(como(w.b.host, uid))

    beforeAll(async () => {
      const curso = await seedCourse(t, { tenantId: w.b.id, slug: 'formado-no-b', title: 'Formado no B', instructorId: w.u.teacherB })
      slug = curso.slug
      for (const uid of [w.u.studentB, w.u.shared]) {
        await t.pool.query("INSERT INTO enrollments (id, user_id, course_id, status, source, activated_at) VALUES (?, ?, ?, 'active', 'free', NOW())", [randomUUID(), uid, curso.id])
        await t.pool.query('INSERT INTO lesson_progress (id, user_id, lesson_id, completed, completed_at) VALUES (?, ?, ?, 1, NOW())', [randomUUID(), uid, curso.lessonId])
      }
      // o aluno do B se forma com o curso no ar; depois o curso sai do ar
      expect((await emitir(w.u.studentB)).status).toBe(200)
      await t.pool.query("UPDATE courses SET status = 'draft', review_note = 'Retirado para revisão.' WHERE id = ?", [curso.id])
    })

    it('o titular segue baixando o PDF e vendo o status', async () => {
      const pdf = await emitir(w.u.studentB)
      expect(pdf.status).toBe(200)
      expect(pdf.headers['content-type']).toContain('application/pdf')
      const status = await situacao(w.u.studentB)
      expect([status.status, status.body]).toEqual([200, { settled: true, paidCount: 0, totalCount: 0, carneUrl: null }])
    })

    it('o matriculado que ainda não tem certificado recebe 403 COURSE_UNAVAILABLE na emissão e no status, e nada é emitido', async () => {
      const antes = await cursosCertificados(w.u.shared)
      for (const r of [await emitir(w.u.shared), await situacao(w.u.shared)]) {
        expect([r.status, r.body]).toEqual([403, { statusCode: 403, code: 'COURSE_UNAVAILABLE', message: NO_POLO }])
      }
      expect(await cursosCertificados(w.u.shared)).toEqual(antes)
    })

    it('quem não tem matrícula recebe 404, como se o curso não existisse', async () => {
      expect([(await emitir(w.u.studentA)).status, (await situacao(w.u.studentA)).status]).toEqual([404, 404])
    })
  })

  // O titular de um certificado concluiu o curso que havia: se o curso muda depois (aula ou prova nova, numa revisão
  // durante a retirada do ar), ele continua baixando o dele. Emitir um certificado NOVO continua exigindo a conclusão.
  describe('o titular recebe o certificado mesmo depois que o curso mudou', () => {
    let slug: string
    let cursoId: string
    const baixar = (uid: string) => app.http().get(`/api/me/courses/${slug}/certificate`).query({ cpf: '52998224725' }).set(como(w.b.host, uid))

    beforeAll(async () => {
      const curso = await seedCourse(t, { tenantId: w.b.id, slug: 'revisado-no-b', title: 'Revisado no B', instructorId: w.u.teacherB })
      slug = curso.slug
      cursoId = curso.id
      for (const uid of [w.u.studentB, w.u.shared]) {
        await t.pool.query("INSERT INTO enrollments (id, user_id, course_id, status, source, activated_at) VALUES (?, ?, ?, 'active', 'free', NOW())", [randomUUID(), uid, curso.id])
        await t.pool.query('INSERT INTO lesson_progress (id, user_id, lesson_id, completed, completed_at) VALUES (?, ?, ?, 1, NOW())', [randomUUID(), uid, curso.lessonId])
      }
      expect((await baixar(w.u.studentB)).status).toBe(200) // formou-se no curso como era
      // a revisão: uma aula nova e uma prova no módulo, que ninguém fez ainda
      await t.pool.query("INSERT INTO lessons (id, module_id, title, duration_sec, sort_order, is_free_preview) VALUES (?, ?, 'Aula Nova', 600, 1, 0)", [randomUUID(), curso.moduleId])
      await t.pool.query(
        "INSERT INTO quiz_questions (id, module_id, prompt, options, correct_index, sort_order) VALUES (?, ?, 'Pergunta nova?', '[\"a\",\"b\"]', 0, 0)",
        [randomUUID(), curso.moduleId]
      )
    })

    it('o titular baixa de novo (200), sem a aula nova e sem a prova nova', async () => {
      const r = await baixar(w.u.studentB)
      expect(r.status).toBe(200)
      expect(r.headers['content-type']).toContain('application/pdf')
    })

    it('quem ainda não tem o certificado continua precisando concluir o curso como ele é agora', async () => {
      const r = await baixar(w.u.shared)
      expect([r.status, r.body.message]).toEqual([403, 'Conclua 100% do curso para emitir o certificado.'])
      expect(await cursosCertificados(w.u.shared)).not.toContain(cursoId)
    })
  })

  describe('emissão sem requisitos: o corpo é validado', () => {
    const semCpf = 'u-sem-cpf'
    const emitir = (corpo: object) =>
      app.http().post(`/api/admin/students/${semCpf}/courses/${w.courses.a.id}/certificate`).set(como(w.a.host, w.u.platform)).send(corpo)
    const situacao = async () => ({
      cpf: ((await t.pool.query('SELECT cpf FROM users WHERE uid = ?', [semCpf]))[0] as Array<{ cpf: string | null }>)[0].cpf,
      certificados: await cursosCertificados(semCpf),
    })

    beforeAll(async () => {
      await t.pool.query("INSERT INTO users (uid, email, display_name, roles, cpf) VALUES (?, ?, 'Aluna Sem CPF', '[\"student\"]', NULL)", [semCpf, `${semCpf}@teste.local`])
      await t.pool.query("INSERT INTO enrollments (id, user_id, course_id, status, source, activated_at) VALUES (?, ?, ?, 'active', 'free', NOW())", [randomUUID(), semCpf, w.courses.a.id])
    })

    it('CPF que não é texto, CPF inválido e campo a mais: 400 em português, e nada é emitido nem gravado no cadastro', async () => {
      for (const corpo of [{ cpf: 123 }, { cpf: '111' }, { cpf: '111.111.111-11' }, { cpf: '' }]) {
        const r = await emitir(corpo)
        expect([JSON.stringify(corpo), r.status, r.body.message]).toEqual([JSON.stringify(corpo), 400, ['CPF inválido.']])
      }
      const extra = await emitir({ cpf: '52998224725', tenantId: 'outro' })
      expect(extra.status).toBe(400)
      expect(await situacao()).toEqual({ cpf: null, certificados: [] })
    })

    it('CPF válido (com ou sem máscara) emite', async () => {
      const r = await emitir({ cpf: '529.982.247-25' })
      expect(r.status).toBe(201)
      expect(r.headers['content-type']).toContain('application/pdf')
      expect(await situacao()).toEqual({ cpf: '52998224725', certificados: [w.courses.a.id] })
    })
  })

  describe('rastro das ações sobre modelos de certificado', () => {
    const base = '/api/admin/certificate-template'
    const logs = (where: string, params: unknown[]) =>
      eventually(
        async () => (await t.pool.query(`SELECT tenant_id, actor_uid, action, summary, target_type, target_id FROM audit_logs WHERE ${where} ORDER BY tenant_id`, params))[0] as Array<Record<string, unknown>>,
        (v) => v.length > 0
      )

    it('criar o modelo grava no log da rede (sem polo)', async () => {
      const criado = await app.http().post(base).set(como(w.matriz.host, w.u.platform)).send({ name: 'Modelo com Rastro', html: '<html><body>rastro</body></html>' })
      expect(criado.status).toBe(201)
      expect(await logs("action = 'certificate-template.create' AND target_id = ?", [criado.body.id])).toEqual([{
        tenant_id: null, actor_uid: w.u.platform, action: 'certificate-template.create', summary: 'Criou o modelo de certificado "Modelo com Rastro"',
        target_type: 'certificate-template', target_id: criado.body.id,
      }])
      const rede = (await app.http().get('/api/platform/logs').set(como(w.matriz.host, w.u.platform))).body.logs as Array<{ action: string; targetId: string; tenantName: string | null }>
      expect(rede.find((l) => l.action === 'certificate-template.create' && l.targetId === criado.body.id)).toMatchObject({ tenantName: null })
    })

    it('vincular grava uma entrada no polo de cada curso, com o título do curso e o nome do modelo; o outro polo não vê', async () => {
      const criado = await app.http().post(base).set(como(w.matriz.host, w.u.platform)).send({ name: 'Modelo Rede', html: '<html><body>rede</body></html>' })
      const vinculo = await app.http().post(`${base}/vincular`).set(como(w.matriz.host, w.u.platform)).send({ templateId: criado.body.id, courseIds: [w.courses.a.id, w.courses.b.id] })
      expect(vinculo.body).toEqual({ atualizados: 2 })
      // (o teste "só da plataforma", acima, também vinculou o curso do A: aqui só as entradas deste modelo)
      const porCurso = await eventually(
        () => logs("action = 'certificate-template.assign' AND target_id IN (?, ?) AND summary LIKE ?", [w.courses.a.id, w.courses.b.id, '%"Modelo Rede"']),
        (v) => v.length >= 2
      )
      const esperado = [
        { tenant_id: w.a.id, actor_uid: w.u.platform, action: 'certificate-template.assign', summary: 'Curso "Excel do Polo A": modelo de certificado "Modelo Rede"', target_type: 'course', target_id: w.courses.a.id },
        { tenant_id: w.b.id, actor_uid: w.u.platform, action: 'certificate-template.assign', summary: 'Curso "Excel do Polo B": modelo de certificado "Modelo Rede"', target_type: 'course', target_id: w.courses.b.id },
      ].sort((x, y) => String(x.tenant_id).localeCompare(String(y.tenant_id)))
      expect(porCurso).toEqual(esperado)
      // cada polo vê a entrada do próprio curso, e não a do outro
      const doA = (await app.http().get('/api/admin/logs').set(como(w.a.host, w.u.adminA))).body.logs as Array<{ action: string; targetId: string; summary: string }>
      const vinculosNoA = doA.filter((l) => l.action === 'certificate-template.assign')
      expect(vinculosNoA.map((l) => l.summary)).toContain('Curso "Excel do Polo A": modelo de certificado "Modelo Rede"')
      expect(vinculosNoA.every((l) => l.targetId === w.courses.a.id)).toBe(true)

      // desvincular (modelo nulo) também fica no log do polo
      expect((await app.http().post(`${base}/vincular`).set(como(w.matriz.host, w.u.platform)).send({ templateId: null, courseIds: [w.courses.a.id] })).status).toBe(201)
      const desvinculo = await logs("action = 'certificate-template.assign' AND target_id = ? AND summary LIKE ?", [w.courses.a.id, '%padrão'])
      expect(desvinculo).toEqual([expect.objectContaining({ tenant_id: w.a.id, summary: 'Curso "Excel do Polo A": voltou ao modelo de certificado padrão' })])
    })
  })
})
