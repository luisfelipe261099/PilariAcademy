import { randomUUID } from 'node:crypto'
import { lessons } from '../../src/db/schema'
import { AuthoringService } from '../../src/modules/authoring/authoring.service'
import { bootTestApp, type TestApp } from './helpers/app'
import { createTestDatabase, type TestDatabase } from './helpers/db'
import { bearer, seedCourse, seedMember, seedTwoPolos, seedUser, type TwoPolos } from './helpers/seed'
import { eventually } from './helpers/wait'

describe('aprovação e trava', () => {
  let t: TestDatabase
  let app: TestApp
  let w: TwoPolos
  /** Instrutor (sem ser admin) da matriz: o admin da matriz publica direto, ele não. */
  const profMatriz = 'u-prof-m'
  let seq = 0

  beforeAll(async () => {
    t = await createTestDatabase()
    app = await bootTestApp(t.url)
    w = await seedTwoPolos(t)
    await seedUser(t, { uid: profMatriz })
    await seedMember(t, w.matriz.id, profMatriz, ['teacher'])
  })
  afterAll(async () => {
    try {
      await app?.close()
    } finally {
      await t?.drop()
    }
  })

  const status = (host: string, uid: string, courseId: string, s: string) =>
    app.http().patch(`/api/instructor/courses/${courseId}/status`).set('Host', host).set('Authorization', bearer(uid)).send({ status: s })
  const patch = (host: string, uid: string, courseId: string, body: Record<string, unknown>) =>
    app.http().patch(`/api/instructor/courses/${courseId}`).set('Host', host).set('Authorization', bearer(uid)).send(body)
  const meta = (host: string, uid: string, courseId: string) =>
    app.http().get(`/api/instructor/courses/${courseId}/meta`).set('Host', host).set('Authorization', bearer(uid))
  const linha = async (courseId: string, colunas: string): Promise<Record<string, unknown>> => {
    const [rows] = await t.pool.query(`SELECT ${colunas} FROM courses WHERE id = ?`, [courseId])
    return (rows as Array<Record<string, unknown>>)[0]
  }
  /** Curso novo no polo A, só para um teste: o estado dele não vaza para os outros. */
  const novoCursoA = async (input: { status?: 'draft' | 'in_review' | 'published'; approved?: boolean; instructorId?: string } = {}) => {
    seq += 1
    const title = `Curso de Aprovação ${seq}`
    const c = await seedCourse(t, {
      tenantId: w.a.id, slug: `aprov-${seq}`, title, instructorId: input.instructorId ?? w.u.teacherA,
      status: input.status ?? 'published', approved: input.approved,
    })
    return { ...c, title }
  }

  it('fluxo completo: envio, recusa do admin do polo, aprovação da plataforma', async () => {
    const id = w.courses.aDraft.id
    expect((await status(w.a.host, w.u.teacherA, id, 'in_review')).status).toBe(200)
    const negado = await status(w.a.host, w.u.adminA, id, 'published')
    expect(negado.status).toBe(403)
    expect(negado.body.code).toBe('APPROVAL_REQUIRED')
    expect((await status(w.a.host, w.u.platform, id, 'published')).status).toBe(200)
    const [rows] = await t.pool.query('SELECT status, approved_by, approved_at IS NOT NULL AS aprovado FROM courses WHERE id = ?', [id])
    expect(rows).toEqual([{ status: 'published', approved_by: w.u.platform, aprovado: 1 }])
    // o envio para análise também ficou registrado, e a publicação carimbou publishedAt
    expect(await linha(id, 'submitted_at IS NOT NULL AS enviado, published_at IS NOT NULL AS no_ar')).toEqual({ enviado: 1, no_ar: 1 })
  })

  it('curso aprovado sai e volta do ar pelo admin do polo', async () => {
    const id = w.courses.a.id
    expect((await status(w.a.host, w.u.adminA, id, 'draft')).status).toBe(200)
    expect((await status(w.a.host, w.u.adminA, id, 'published')).status).toBe(200)
  })

  it('formulário inteiro sem mudar os campos travados passa; mudar carga horária falha', async () => {
    const id = w.courses.a.id
    await t.pool.query('UPDATE courses SET workload_hours = 40 WHERE id = ?', [id])
    expect((await patch(w.a.host, w.u.adminA, id, { title: 'Excel do Polo A', workloadHours: 40, description: 'Nova descrição' })).status).toBe(200)
    const r = await patch(w.a.host, w.u.adminA, id, { workloadHours: 360 })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('CERTIFICATE_FIELDS_LOCKED')
  })

  it('a plataforma corrige o título de curso aprovado', async () => {
    expect((await patch(w.a.host, w.u.platform, w.courses.a.id, { title: 'Excel Essencial' })).status).toBe(200)
  })

  it('o admin da matriz publica curso da matriz direto', async () => {
    const c = await seedCourse(t, { tenantId: w.matriz.id, slug: 'novo-matriz', title: 'Novo da Matriz', instructorId: w.u.adminMatriz, status: 'draft' })
    expect((await status(w.matriz.host, w.u.adminMatriz, c.id, 'published')).status).toBe(200)
    // na matriz a publicação do admin já é a aprovação, e congela a carga calculada: a única aula
    // tem 10 minutos, que arredondam para 0 h, e o certificado nunca imprime menos de 1 h
    expect(await linha(c.id, 'status, approved_by, approved_at IS NOT NULL AS aprovado, workload_hours')).toEqual({
      status: 'published', approved_by: w.u.adminMatriz, aprovado: 1, workload_hours: 1,
    })
  })

  it('o instrutor da matriz envia para análise, mas só o admin da matriz publica', async () => {
    const c = await seedCourse(t, { tenantId: w.matriz.id, slug: 'do-prof-matriz', title: 'Do Professor da Matriz', instructorId: profMatriz, status: 'draft' })
    expect((await status(w.matriz.host, profMatriz, c.id, 'in_review')).status).toBe(200)
    const negado = await status(w.matriz.host, profMatriz, c.id, 'published')
    expect(negado.status).toBe(403)
    expect(negado.body.code).toBe('APPROVAL_REQUIRED')
    expect((await linha(c.id, 'status')).status).toBe('in_review')
    expect((await status(w.matriz.host, w.u.adminMatriz, c.id, 'published')).status).toBe(200)
    expect((await linha(c.id, 'approved_by')).approved_by).toBe(w.u.adminMatriz)
  })

  describe('transições do instrutor e do admin do polo', () => {
    it('instrutor tira o próprio curso do ar, mas não publica de volta nem arquiva', async () => {
      const c = await novoCursoA()
      expect((await status(w.a.host, w.u.teacherA, c.id, 'draft')).status).toBe(200)
      const volta = await status(w.a.host, w.u.teacherA, c.id, 'published')
      expect(volta.status).toBe(403)
      expect(volta.body.code).toBe('APPROVAL_REQUIRED')
      const arquiva = await status(w.a.host, w.u.teacherA, c.id, 'archived')
      expect(arquiva.status).toBe(403)
      expect(arquiva.body.code).toBe('FORBIDDEN')
      expect((await linha(c.id, 'status')).status).toBe('draft')
      // o admin do polo republica o que já foi aprovado, sem nova análise e sem regravar a aprovação
      const antes = await linha(c.id, 'approved_at, approved_by')
      expect((await status(w.a.host, w.u.adminA, c.id, 'published')).status).toBe(200)
      expect(await linha(c.id, 'approved_at, approved_by')).toEqual(antes)
    })

    it('admin do polo arquiva curso aprovado', async () => {
      const c = await novoCursoA()
      expect((await status(w.a.host, w.u.adminA, c.id, 'archived')).status).toBe(200)
      expect((await linha(c.id, 'status')).status).toBe('archived')
    })

    it('só rascunho vai para análise: curso publicado responde 400 INVALID_TRANSITION', async () => {
      const c = await novoCursoA()
      const r = await status(w.a.host, w.u.teacherA, c.id, 'in_review')
      expect(r.status).toBe(400)
      expect(r.body.code).toBe('INVALID_TRANSITION')
      expect((await linha(c.id, 'status')).status).toBe('published')
    })

    it('curso já em análise: quem não aprova recebe "aguarde a aprovação", não "envie para análise"', async () => {
      const emAnalise = await novoCursoA({ status: 'in_review', approved: false })
      for (const uid of [w.u.adminA, w.u.teacherA]) {
        const r = await status(w.a.host, uid, emAnalise.id, 'published')
        expect([uid, r.status, r.body.code, r.body.message]).toEqual([uid, 403, 'APPROVAL_REQUIRED', 'Este curso está em análise pelo Studio Pilari. Aguarde a aprovação.'])
      }
      // rascunho nunca aprovado continua com a orientação de enviar para análise
      const rascunho = await novoCursoA({ status: 'draft', approved: false })
      expect((await status(w.a.host, w.u.adminA, rascunho.id, 'published')).body.message).toBe(
        'A publicação deste curso depende da aprovação do Studio Pilari. Envie o curso para análise.'
      )
      expect(await linha(emAnalise.id, 'status')).toEqual({ status: 'in_review' })
    })

    it('a troca de status vai para o log do polo com o título do curso; repetir o status não grava nada', async () => {
      const c = await novoCursoA()
      const doCurso = async () =>
        (await t.pool.query("SELECT tenant_id, actor_uid, summary FROM audit_logs WHERE action = 'course.status' AND target_id = ?", [c.id]))[0] as Array<Record<string, unknown>>
      expect((await status(w.a.host, w.u.adminA, c.id, 'published')).status).toBe(200) // já está publicado: nada a gravar
      expect((await status(w.a.host, w.u.adminA, c.id, 'draft')).status).toBe(200)
      const logs = await eventually(doCurso, (v) => v.length > 0)
      expect(logs).toEqual([{ tenant_id: w.a.id, actor_uid: w.u.adminA, summary: `Curso "${c.title}": publicado → rascunho` }])
    })

    it('corrida: o curso mudou de situação entre a leitura e a gravação → 400 INVALID_TRANSITION e nada é gravado', async () => {
      // O Studio Pilari tirou o curso do ar (rascunho com nota) enquanto o admin do polo arquivava a versão publicada que ele
      // tinha lido: a gravação só vale sobre a situação lida, e o curso fica como o Studio Pilari deixou.
      const c = await novoCursoA()
      const [rows] = await t.pool.query('SELECT * FROM courses WHERE id = ?', [c.id])
      const r0 = (rows as Array<Record<string, unknown>>)[0]
      const lido = {
        ...r0, tenantId: r0.tenant_id, instructorId: r0.instructor_id, approvedAt: r0.approved_at, publishedAt: r0.published_at,
        reviewNote: r0.review_note, workloadHours: r0.workload_hours,
      }
      await t.pool.query("UPDATE courses SET status = 'draft', review_note = 'Direitos autorais.' WHERE id = ?", [c.id])
      const escopo = (app.app.get(AuthoringService) as unknown as { scope: { owned: (...a: unknown[]) => Promise<unknown> } }).scope
      const leitura = jest.spyOn(escopo, 'owned').mockResolvedValueOnce(lido)
      try {
        const r = await status(w.a.host, w.u.adminA, c.id, 'archived')
        expect([r.status, r.body]).toEqual([400, {
          statusCode: 400, code: 'INVALID_TRANSITION', message: 'O curso mudou de situação enquanto você decidia. Recarregue a página.',
        }])
      } finally {
        leitura.mockRestore()
      }
      expect(await linha(c.id, 'status, review_note')).toEqual({ status: 'draft', review_note: 'Direitos autorais.' })
    })

    it('a plataforma aprova pelo endereço do polo do curso; pelo endereço de outro polo é 404', async () => {
      const c = await seedCourse(t, { tenantId: w.b.id, slug: 'em-analise-b', title: 'Em Análise no B', instructorId: w.u.teacherB, status: 'in_review' })
      const errado = await status(w.a.host, w.u.platform, c.id, 'published')
      expect(errado.status).toBe(404)
      expect(await linha(c.id, 'status, approved_at')).toEqual({ status: 'in_review', approved_at: null })
      expect((await status(w.b.host, w.u.platform, c.id, 'published')).status).toBe(200)
      expect(await linha(c.id, 'status, approved_by')).toEqual({ status: 'published', approved_by: w.u.platform })
    })
  })

  describe('nota do Studio Pilari (curso devolvido ou tirado do ar)', () => {
    it('tirado do ar com nota: enviar para análise e desistir NÃO apagam a nota, o polo não republica, e só a aprovação da plataforma a apaga', async () => {
      // O estado que a retirada do ar da plataforma deixa: curso aprovado, de volta a rascunho, com a nota.
      const c = await novoCursoA({ status: 'draft', approved: true })
      await t.pool.query("UPDATE courses SET review_note = 'Aula 3 sem áudio.', approved_by = 'u-plat-anterior' WHERE id = ?", [c.id])
      const primeiraAprovacao = await linha(c.id, 'approved_at, approved_by')
      const comNota = (st: string) => ({ status: st, review_note: 'Aula 3 sem áudio.' })

      // o instrutor envia para análise: ok, e a nota continua no banco
      expect((await status(w.a.host, w.u.teacherA, c.id, 'in_review')).status).toBe(200)
      expect(await linha(c.id, 'status, review_note')).toEqual(comNota('in_review'))
      // em análise, o admin do polo também não aprova
      const emAnalise = await status(w.a.host, w.u.adminA, c.id, 'published')
      expect([emAnalise.status, emAnalise.body.code]).toEqual([403, 'APPROVAL_REQUIRED'])
      expect(await linha(c.id, 'status, review_note')).toEqual(comNota('in_review'))

      // o instrutor desiste da análise: ok, e a nota continua no banco
      expect((await status(w.a.host, w.u.teacherA, c.id, 'draft')).status).toBe(200)
      expect(await linha(c.id, 'status, review_note')).toEqual(comNota('draft'))

      // o admin do polo tenta republicar: barrado, com o aviso do Studio Pilari
      const barrado = await status(w.a.host, w.u.adminA, c.id, 'published')
      expect(barrado.status).toBe(403)
      expect(barrado.body.code).toBe('APPROVAL_REQUIRED')
      expect(barrado.body.message).toContain('O Studio Pilari pediu ajustes')
      expect(await linha(c.id, 'status, review_note')).toEqual(comNota('draft'))

      // a plataforma aprova de novo: o curso volta ao ar, a nota some e a primeira aprovação fica como estava
      expect((await status(w.a.host, w.u.platform, c.id, 'published')).status).toBe(200)
      expect(await linha(c.id, 'status, review_note')).toEqual({ status: 'published', review_note: null })
      expect(await linha(c.id, 'approved_at, approved_by')).toEqual(primeiraAprovacao)
      expect((await linha(c.id, 'approved_by')).approved_by).toBe('u-plat-anterior')
    })

    it('o instrutor corrige e reenvia: o curso devolvido na primeira análise segue com a nota até a plataforma aprovar', async () => {
      // Devolvido antes de qualquer aprovação (sem approved_at): a mesma regra, e agora a aprovação é a primeira.
      const c = await novoCursoA({ status: 'draft', approved: false })
      await t.pool.query("UPDATE courses SET review_note = 'Falta a ementa.' WHERE id = ?", [c.id])
      expect((await status(w.a.host, w.u.teacherA, c.id, 'in_review')).status).toBe(200)
      expect((await linha(c.id, 'review_note')).review_note).toBe('Falta a ementa.')
      expect((await status(w.a.host, w.u.platform, c.id, 'published')).status).toBe(200)
      expect(await linha(c.id, 'status, review_note, approved_by, approved_at IS NOT NULL AS aprovado')).toEqual({
        status: 'published', review_note: null, approved_by: w.u.platform, aprovado: 1,
      })
    })

    it('repetir o status em que o curso já está não grava nada, não confere aulas e não apaga a nota', async () => {
      const c = await novoCursoA({ status: 'in_review', approved: true })
      await t.pool.query("UPDATE courses SET review_note = 'Falta a ementa.', updated_at = '2020-01-01 00:00:00.000' WHERE id = ?", [c.id])
      const colunas = 'status, review_note, updated_at, submitted_at, published_at, approved_at, approved_by, workload_hours'
      const antes = await linha(c.id, colunas)
      expect((await status(w.a.host, w.u.teacherA, c.id, 'in_review')).status).toBe(200)
      expect(await linha(c.id, colunas)).toEqual(antes)
      // sem aula nenhuma, o mesmo pedido continua 200: não houve checagem de aulas, porque não houve transição
      await t.pool.query('DELETE FROM lessons WHERE module_id = ?', [c.moduleId])
      expect((await status(w.a.host, w.u.teacherA, c.id, 'in_review')).status).toBe(200)
      expect(await linha(c.id, colunas)).toEqual(antes)
      // já a transição de verdade continua exigindo aula
      expect((await status(w.a.host, w.u.platform, c.id, 'published')).status).toBe(400)
    })

    it('voltar para rascunho é livre e mantém a nota para o instrutor ler', async () => {
      const c = await novoCursoA({ status: 'in_review', approved: true })
      await t.pool.query("UPDATE courses SET review_note = 'Ajuste o título.' WHERE id = ?", [c.id])
      expect((await status(w.a.host, w.u.teacherA, c.id, 'draft')).status).toBe(200)
      expect(await linha(c.id, 'status, review_note')).toEqual({ status: 'draft', review_note: 'Ajuste o título.' })
    })
  })

  describe('a carga horária calculada é congelada na primeira aprovação', () => {
    // Sem carga declarada, o certificado imprime a soma da duração das aulas, e as aulas seguem editáveis depois
    // da aprovação: sem o congelamento, o número impresso mudaria sem passar pela trava dos dados do certificado.
    /** Curso em análise com duas aulas (7200 s + 5760 s = 3,6 h): a soma só vira 4 h arredondando. */
    const novoEmAnalise = async (cargaDeclarada: number | null) => {
      const c = await novoCursoA({ status: 'in_review', approved: false })
      await t.pool.query('UPDATE lessons SET duration_sec = 7200 WHERE id = ?', [c.lessonId])
      await t.db.insert(lessons).values({ id: randomUUID(), moduleId: c.moduleId, title: 'Aula 2', durationSec: 5760, order: 1, isFreePreview: false })
      if (cargaDeclarada !== null) await t.pool.query('UPDATE courses SET workload_hours = ? WHERE id = ?', [cargaDeclarada, c.id])
      return c
    }

    it('curso sem carga declarada recebe a calculada ao ser aprovado, e mexer nas aulas depois não a altera', async () => {
      const c = await novoEmAnalise(null)
      expect((await linha(c.id, 'workload_hours')).workload_hours).toBeNull()
      expect((await status(w.a.host, w.u.platform, c.id, 'published')).status).toBe(200)
      expect((await linha(c.id, 'workload_hours')).workload_hours).toBe(4)

      // as aulas continuam editáveis depois da aprovação, e a carga impressa não as acompanha
      const aula = await app.http().patch(`/api/instructor/lessons/${c.lessonId}`).set('Host', w.a.host).set('Authorization', bearer(w.u.teacherA)).send({ durationSec: 360000 })
      expect(aula.status).toBe(200)
      expect((await linha(c.id, 'workload_hours')).workload_hours).toBe(4)
      expect((await meta(w.a.host, w.u.adminA, c.id)).body.course.workloadHours).toBe(4)
    })

    it('o valor congelado já está sob a trava: mudar ou voltar para "calculada" é barrado; repetir o valor passa', async () => {
      const c = await novoEmAnalise(null)
      expect((await status(w.a.host, w.u.platform, c.id, 'published')).status).toBe(200)
      for (const novo of [null, 6]) {
        const r = await patch(w.a.host, w.u.adminA, c.id, { workloadHours: novo })
        expect([novo, r.status, r.body.code, r.body.fields]).toEqual([novo, 403, 'CERTIFICATE_FIELDS_LOCKED', ['workloadHours']])
      }
      expect((await linha(c.id, 'workload_hours')).workload_hours).toBe(4)
      // o editor, que agora abre com o 4 no campo, salva o formulário inteiro sem problema
      expect((await patch(w.a.host, w.u.adminA, c.id, { workloadHours: 4, description: 'Texto novo' })).status).toBe(200)
      // e a plataforma continua podendo corrigir
      expect((await patch(w.a.host, w.u.platform, c.id, { workloadHours: 6 })).status).toBe(200)
      expect((await linha(c.id, 'workload_hours')).workload_hours).toBe(6)
    })

    it('a carga declarada pelo polo antes da aprovação vale e não é trocada pela calculada', async () => {
      const c = await novoEmAnalise(180)
      expect((await status(w.a.host, w.u.platform, c.id, 'published')).status).toBe(200)
      expect((await linha(c.id, 'workload_hours')).workload_hours).toBe(180)
    })

    it('só a primeira aprovação congela: o curso aprovado antes, sem carga, volta ao ar sem recebê-la (sem retroativo)', async () => {
      const c = await novoCursoA({ status: 'draft', approved: true })
      expect((await linha(c.id, 'workload_hours')).workload_hours).toBeNull()
      expect((await status(w.a.host, w.u.adminA, c.id, 'published')).status).toBe(200)
      expect((await linha(c.id, 'workload_hours')).workload_hours).toBeNull()
    })

    it('enviar para análise não congela nada: a carga só é gravada quando a aprovação acontece', async () => {
      const c = await novoCursoA({ status: 'draft', approved: false })
      expect((await status(w.a.host, w.u.teacherA, c.id, 'in_review')).status).toBe(200)
      expect((await linha(c.id, 'workload_hours')).workload_hours).toBeNull()
    })
  })

  describe('o editor manda o formulário inteiro depois da aprovação', () => {
    /** O que o CourseEditorPage envia no Salvar: todos os campos, na forma em que o meta os devolve. */
    const formularioDe = (m: Record<string, unknown>): Record<string, unknown> => ({
      title: m.title, subtitle: m.subtitle, description: m.description, categoryId: m.categoryId,
      priceInCents: m.priceInCents, promoPriceInCents: m.promoPriceInCents, promoEndsAt: m.promoEndsAt,
      coverImageUrl: m.coverImageUrl, coverFocus: m.coverFocus, availableAt: m.availableAt,
      coordinatorName: m.coordinatorName, coordinatorRole: m.coordinatorRole,
      coordinatorSignaturePath: m.coordinatorSignaturePath, workloadHours: m.workloadHours,
    })
    const TRAVADAS = 'title, workload_hours, coordinator_name, coordinator_role, coordinator_signature_path'

    it('sem mudar título, carga horária e coordenador passa; mudar qualquer um falha e nada é gravado', async () => {
      const c = await novoCursoA()
      await t.pool.query(
        'UPDATE courses SET workload_hours = 180, coordinator_name = ?, coordinator_role = ?, coordinator_signature_path = ?, subtitle = ? WHERE id = ?',
        ['Ana Souza', 'Coordenadora do Curso', `cursos/${c.id}/signature/ana.png`, 'Subtítulo', c.id]
      )
      const original = await linha(c.id, TRAVADAS)
      const form = formularioDe((await meta(w.a.host, w.u.adminA, c.id)).body.course)

      const salvo = await patch(w.a.host, w.u.adminA, c.id, { ...form, description: 'Descrição nova' })
      expect(salvo.status).toBe(200)
      expect(salvo.body.course).toMatchObject({ description: 'Descrição nova', workloadHours: 180, coordinatorName: 'Ana Souza', certificateFieldsLocked: true })

      const mudancas: Array<[string, Record<string, unknown>]> = [
        ['title', { title: 'Outro Título' }],
        ['workloadHours', { workloadHours: 360 }],
        ['coordinatorName', { coordinatorName: 'Beto Lima' }],
        ['coordinatorRole', { coordinatorRole: 'Diretor' }],
        ['coordinatorSignaturePath', { coordinatorSignaturePath: `cursos/${c.id}/signature/beto.png` }],
      ]
      for (const [campo, mudanca] of mudancas) {
        const r = await patch(w.a.host, w.u.adminA, c.id, { ...form, ...mudanca })
        expect([campo, r.status, r.body.code, r.body.fields]).toEqual([campo, 403, 'CERTIFICATE_FIELDS_LOCKED', [campo]])
      }
      // apagar o coordenador inteiro também é mudar
      const limpa = await patch(w.a.host, w.u.adminA, c.id, { ...form, coordinatorName: null, coordinatorRole: null, coordinatorSignaturePath: null })
      expect([limpa.status, limpa.body.fields]).toEqual([403, ['coordinatorName', 'coordinatorRole', 'coordinatorSignaturePath']])
      expect(limpa.body.message).toBe(
        'Depois da aprovação, o coordenador, o cargo do coordenador e a assinatura do coordenador só mudam pelo Studio Pilari. Peça a alteração ao Studio Pilari.'
      )
      // nada do que foi recusado chegou ao banco; só a descrição do save que passou
      expect(await linha(c.id, TRAVADAS)).toEqual(original)
      expect((await linha(c.id, 'description')).description).toBe('Descrição nova')
    })

    it('a mensagem de erro é em português, nomeia o que travou e o verbo concorda com a lista', async () => {
      const c = await novoCursoA()
      const um = await patch(w.a.host, w.u.adminA, c.id, { workloadHours: 360 })
      expect(um.status).toBe(403)
      expect(um.body).toEqual({
        statusCode: 403,
        code: 'CERTIFICATE_FIELDS_LOCKED',
        message: 'Depois da aprovação, a carga horária só muda pelo Studio Pilari. Peça a alteração ao Studio Pilari.',
        fields: ['workloadHours'],
      })
      const dois = await patch(w.a.host, w.u.adminA, c.id, { title: 'Outro Título', workloadHours: 360 })
      expect(dois.body.message).toBe('Depois da aprovação, o título e a carga horária só mudam pelo Studio Pilari. Peça a alteração ao Studio Pilari.')
    })

    it('a plataforma muda título, carga horária e coordenador de curso aprovado', async () => {
      const c = await novoCursoA()
      const r = await patch(w.a.host, w.u.platform, c.id, {
        title: 'Título Corrigido', workloadHours: 360, coordinatorName: 'Beto Lima', coordinatorRole: 'Diretor',
      })
      expect(r.status).toBe(200)
      expect(r.body.course).toMatchObject({ title: 'Título Corrigido', workloadHours: 360, coordinatorName: 'Beto Lima', certificateFieldsLocked: false })
      expect(await linha(c.id, 'title, workload_hours, coordinator_name')).toEqual({ title: 'Título Corrigido', workload_hours: 360, coordinator_name: 'Beto Lima' })
    })

    it('o instrutor dono: o coordenador é descartado (como antes), mas título e carga horária ficam travados', async () => {
      const c = await novoCursoA()
      await t.pool.query('UPDATE courses SET workload_hours = 40, coordinator_name = ? WHERE id = ?', ['Ana Souza', c.id])
      const form = formularioDe((await meta(w.a.host, w.u.teacherA, c.id)).body.course)
      const salvo = await patch(w.a.host, w.u.teacherA, c.id, { ...form, description: 'Texto do instrutor', coordinatorName: 'Fulano' })
      expect(salvo.status).toBe(200)
      expect(await linha(c.id, 'description, coordinator_name')).toEqual({ description: 'Texto do instrutor', coordinator_name: 'Ana Souza' })
      for (const mudanca of [{ title: 'Novo título' }, { workloadHours: 360 }]) {
        const r = await patch(w.a.host, w.u.teacherA, c.id, mudanca)
        expect([r.status, r.body.code]).toEqual([403, 'CERTIFICATE_FIELDS_LOCKED'])
      }
    })

    it('antes da aprovação nada trava, nem para o admin do polo', async () => {
      const c = await novoCursoA({ status: 'draft', approved: false })
      const r = await patch(w.a.host, w.u.adminA, c.id, { title: 'Título Livre', workloadHours: 360, coordinatorName: 'Beto Lima' })
      expect(r.status).toBe(200)
      expect(r.body.course).toMatchObject({ title: 'Título Livre', workloadHours: 360, coordinatorName: 'Beto Lima', approvedAt: null, certificateFieldsLocked: false })
    })
  })

  describe('o curso informa a aprovação, a nota e a trava para quem está vendo', () => {
    it('meta: aprovado → data em ISO e trava ligada para o polo, desligada para a plataforma', async () => {
      const c = await novoCursoA()
      const polo = await meta(w.a.host, w.u.adminA, c.id)
      expect(polo.status).toBe(200)
      expect(polo.body.course).toMatchObject({ reviewNote: null, certificateFieldsLocked: true })
      // ISO de verdade (ida e volta pelo Date) e a mesma data para quem vê como plataforma
      const iso = polo.body.course.approvedAt as string
      expect(new Date(iso).toISOString()).toBe(iso)
      const plataforma = await meta(w.a.host, w.u.platform, c.id)
      expect(plataforma.body.course).toMatchObject({ approvedAt: iso, certificateFieldsLocked: false })
    })

    it('meta: rascunho nunca aprovado não tem trava; a nota do Studio Pilari aparece', async () => {
      const c = await novoCursoA({ status: 'draft', approved: false })
      await t.pool.query("UPDATE courses SET review_note = 'Falta a ementa.' WHERE id = ?", [c.id])
      const r = await meta(w.a.host, w.u.teacherA, c.id)
      expect(r.body.course).toMatchObject({ approvedAt: null, reviewNote: 'Falta a ementa.', certificateFieldsLocked: false })
    })

    it('a listagem do instrutor traz os mesmos três campos', async () => {
      const aprovado = await novoCursoA()
      const rascunho = await novoCursoA({ status: 'draft', approved: false })
      const r = await app.http().get('/api/instructor/courses').set('Host', w.a.host).set('Authorization', bearer(w.u.teacherA))
      const por = new Map((r.body.courses as Array<{ id: string; approvedAt: string | null; reviewNote: string | null; certificateFieldsLocked: boolean }>).map((c) => [c.id, c]))
      expect(por.get(aprovado.id)).toMatchObject({ certificateFieldsLocked: true, reviewNote: null, approvedAt: expect.any(String) })
      expect(por.get(rascunho.id)).toMatchObject({ certificateFieldsLocked: false, reviewNote: null, approvedAt: null })
    })
  })
})
