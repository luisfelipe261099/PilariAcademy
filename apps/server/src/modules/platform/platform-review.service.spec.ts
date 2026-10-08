/// <reference types="jest" />
import { createDrizzleMock, withQueryResults } from '../../__test-utils__/drizzle-mock'
import { allWheres, renderSql } from '../../__test-utils__/sql'
import { certificateWorkloadHours } from '../../common/lib/certificate-workload'
import { PlatformReviewService } from './platform-review.service'
import { reviewFingerprint } from './review-rules'

const tenants = { siteUrl: jest.fn((t: { slug: string; isMatriz: boolean }) => (t.isMatriz ? 'https://cursos.studiopilari.com.br' : `https://${t.slug}.cursos.studiopilari.com.br`)) }
const curso = (over: Record<string, unknown> = {}) => ({
  id: 'c1', tenantId: 't-a', title: 'Excel', status: 'in_review', publishedAt: null, approvedAt: null, approvedBy: null, reviewNote: null, ...over,
})
/** A versão que a fila mostraria para o curso, com a soma das aulas em segundos. */
const versao = (c: Record<string, unknown>, aulasSec: number): string =>
  reviewFingerprint({
    title: c.title as string,
    workloadHours: certificateWorkloadHours((c.workloadHours as number | null | undefined) ?? null, aulasSec),
    coordinatorName: (c.coordinatorName as string | undefined) ?? null,
    coordinatorRole: (c.coordinatorRole as string | undefined) ?? null,
    coordinatorSignaturePath: (c.coordinatorSignaturePath as string | undefined) ?? null,
  })
/** Fila de resultados da aprovação: [curso], [há aula?], [soma da duração das aulas]. O UPDATE vem depois. */
const leiturasDaAprovacao = (c: Record<string, unknown>, dur: string | null = '3600'): unknown[] => [[c], [{ id: 'l1' }], [{ dur }]]
/** Aprova com a versão certa (a da fila) para o curso e a soma dadas. */
const aprovaDireito = async (svc: PlatformReviewService, db: ReturnType<typeof createDrizzleMock>, c: Record<string, unknown>, dur: string | null = '3600') => {
  withQueryResults(db, ...leiturasDaAprovacao(c, dur))
  return svc.approve('u-plat', c.id as string, versao(c, Number(dur) || 0))
}

describe('PlatformReviewService', () => {
  let db: ReturnType<typeof createDrizzleMock>
  let svc: PlatformReviewService

  beforeEach(() => {
    db = createDrizzleMock()
    svc = new PlatformReviewService(db as never, tenants as never)
  })

  it('aprovar publica, grava a primeira aprovação e limpa a nota', async () => {
    const r = await aprovaDireito(svc, db, curso())
    expect(r).toMatchObject({ id: 'c1', tenantId: 't-a', status: 'published' })
    expect(db.set).toHaveBeenCalledWith(expect.objectContaining({
      status: 'published', approvedAt: expect.any(Date), approvedBy: 'u-plat', publishedAt: expect.any(Date), reviewNote: null,
    }))
  })

  it('reaprovar mantém a data e o autor da primeira aprovação', async () => {
    const primeira = new Date('2026-09-01T00:00:00Z')
    await aprovaDireito(svc, db, curso({ approvedAt: primeira, approvedBy: 'u-antigo', publishedAt: primeira }))
    expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ approvedAt: primeira, approvedBy: 'u-antigo', publishedAt: primeira }))
  })

  it('curso aprovado antes da plataforma existir (data carimbada pela migration, autor desconhecido) não ganha autor na reaprovação', async () => {
    // A migration 0034 carimbou `approved_at` nos cursos já publicados sem autor. Quem reaprova depois não é o autor da
    // primeira aprovação: o par data e autor só é gravado junto, como no setStatus.
    const carimbo = new Date('2026-06-01T00:00:00Z')
    await aprovaDireito(svc, db, curso({ approvedAt: carimbo, approvedBy: null, publishedAt: carimbo }))
    expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ approvedAt: carimbo, approvedBy: null, publishedAt: carimbo }))
  })

  it('só curso em análise é aprovado ou devolvido', async () => {
    withQueryResults(db, [curso({ status: 'draft' })])
    await expect(svc.approve('u-plat', 'c1', 'qualquer')).rejects.toMatchObject({ response: expect.objectContaining({ code: 'INVALID_TRANSITION' }) })
    withQueryResults(db, [curso({ status: 'published' })])
    await expect(svc.returnToDraft('c1', 'motivo')).rejects.toMatchObject({ response: expect.objectContaining({ code: 'INVALID_TRANSITION' }) })
  })

  it('devolver e tirar do ar exigem motivo', async () => {
    await expect(svc.returnToDraft('c1', '  ')).rejects.toThrow('Escreva o motivo')
    await expect(svc.takedown('c1', 'x')).rejects.toThrow('Escreva o motivo')
  })

  it('tirar do ar volta o curso para rascunho com a nota', async () => {
    withQueryResults(db, [curso({ status: 'published', approvedAt: new Date() })])
    await svc.takedown('c1', '  Vídeo com direitos autorais.  ')
    expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'draft', reviewNote: 'Vídeo com direitos autorais.' }))
  })

  it('curso inexistente responde 404', async () => {
    withQueryResults(db, [])
    await expect(svc.approve('u-plat', 'x', 'qualquer')).rejects.toThrow('Curso não encontrado.')
  })

  describe('a aprovação trava a versão que a fila mostrou', () => {
    it('fingerprint que não bate mais: 409 COURSE_CHANGED e nada é gravado', async () => {
      withQueryResults(db, ...leiturasDaAprovacao(curso()))
      const erro = await svc.approve('u-plat', 'c1', versao(curso({ title: 'Título antigo' }), 3600)).then(() => null, (e: unknown) => e)
      expect((erro as { getResponse(): unknown }).getResponse()).toEqual({
        statusCode: 409, code: 'COURSE_CHANGED', message: 'O curso mudou desde que a fila foi carregada. Recarregue e confira antes de aprovar.',
      })
      expect(db.update).not.toHaveBeenCalled()
    })

    it('a carga calculada entra na versão: aulas mais longas que as da fila não passam', async () => {
      withQueryResults(db, ...leiturasDaAprovacao(curso({ workloadHours: null }), '36000'))
      await expect(svc.approve('u-plat', 'c1', versao(curso({ workloadHours: null }), 3600))).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'COURSE_CHANGED' }),
      })
      expect(db.update).not.toHaveBeenCalled()
    })

    it('com a carga definida, a duração das aulas não muda a versão', async () => {
      const c = curso({ workloadHours: 40 })
      withQueryResults(db, ...leiturasDaAprovacao(c, '36000'))
      await expect(svc.approve('u-plat', 'c1', versao(c, 3600))).resolves.toMatchObject({ status: 'published' })
    })

    it('curso sem aula: 400 COURSE_WITHOUT_LESSONS (o mesmo do envio para análise), sem consultar a soma nem gravar', async () => {
      withQueryResults(db, [curso()], [])
      await expect(svc.approve('u-plat', 'c1', versao(curso(), 0))).rejects.toMatchObject({
        response: { statusCode: 400, code: 'COURSE_WITHOUT_LESSONS', message: 'Adicione ao menos uma aula antes de enviar para análise ou publicar.' },
      })
      expect(db.select).toHaveBeenCalledTimes(2)
      expect(db.update).not.toHaveBeenCalled()
    })
  })

  describe('corrida: cada decisão grava só sobre a situação que leu', () => {
    const CORRIDA = { statusCode: 400, code: 'INVALID_TRANSITION', message: 'O curso mudou de situação enquanto você decidia. Recarregue a página.' }
    const APROVACAO_WHERE =
      '(`courses`.`id` = ? and `courses`.`tenant_id` = ? and `courses`.`status` = ? and `courses`.`title` = ? and `courses`.`workload_hours` <=> ? ' +
      'and `courses`.`coordinator_name` <=> ? and `courses`.`coordinator_role` <=> ? and `courses`.`coordinator_signature_path` <=> ?)'
    /** Cabeçalho do mysql2 de um UPDATE que não achou linha. `unknown`: a fila do mock mistura formas diferentes. */
    const nenhumaLinha: unknown = [{ affectedRows: 0 }]
    const umaLinha: unknown = [{ affectedRows: 1 }]

    it('o UPDATE leva o id, o polo e a situação lida', async () => {
      await aprovaDireito(svc, db, curso({ id: 'c9' }))
      withQueryResults(db, [curso({ id: 'c9' })], undefined)
      await svc.returnToDraft('c9', 'Aula 1 sem áudio.')
      withQueryResults(db, [curso({ id: 'c9', status: 'published' })], undefined)
      await svc.takedown('c9', 'Direitos autorais.')
      const updates = allWheres(db.where).filter((w) => w.sql.includes('`courses`.`status`'))
      expect(updates).toEqual([
        { sql: APROVACAO_WHERE, params: ['c9', 't-a', 'in_review', 'Excel', null, null, null, null] },
        { sql: '(`courses`.`id` = ? and `courses`.`tenant_id` = ? and `courses`.`status` = ?)', params: ['c9', 't-a', 'in_review'] },
        { sql: '(`courses`.`id` = ? and `courses`.`tenant_id` = ? and `courses`.`status` = ?)', params: ['c9', 't-a', 'published'] },
      ])
    })

    it('a aprovação exige também os dados travados como foram conferidos (título, carga, coordenador, cargo e assinatura)', async () => {
      const c = curso({ id: 'c9', workloadHours: 40, coordinatorName: 'Ana', coordinatorRole: 'Coordenadora', coordinatorSignaturePath: 'cursos/c9/signature/a.png' })
      await aprovaDireito(svc, db, c)
      const ultimo = allWheres(db.where).pop()
      expect(ultimo).toEqual({ sql: APROVACAO_WHERE, params: ['c9', 't-a', 'in_review', 'Excel', 40, 'Ana', 'Coordenadora', 'cursos/c9/signature/a.png'] })
    })

    it('nenhuma linha atingida na aprovação: com a mesma situação, o que mudou foi o curso (409 COURSE_CHANGED); com outra, a situação (400)', async () => {
      withQueryResults(db, ...leiturasDaAprovacao(curso()), nenhumaLinha, [curso()])
      await expect(svc.approve('u-plat', 'c1', versao(curso(), 3600))).rejects.toMatchObject({ response: expect.objectContaining({ statusCode: 409, code: 'COURSE_CHANGED' }) })
      withQueryResults(db, ...leiturasDaAprovacao(curso()), nenhumaLinha, [curso({ status: 'draft' })])
      await expect(svc.approve('u-plat', 'c1', versao(curso(), 3600))).rejects.toMatchObject({ response: CORRIDA })
    })

    it('nenhuma linha atingida na devolução ou na retirada: 400 INVALID_TRANSITION pedindo para recarregar', async () => {
      withQueryResults(db, [curso()], nenhumaLinha)
      await expect(svc.returnToDraft('c1', 'Aula 1 sem áudio.')).rejects.toMatchObject({ response: CORRIDA })
      withQueryResults(db, [curso({ status: 'published' })], nenhumaLinha)
      await expect(svc.takedown('c1', 'Direitos autorais.')).rejects.toMatchObject({ response: CORRIDA })
    })

    it('uma linha atingida (ou o driver sem a informação) é sucesso', async () => {
      withQueryResults(db, [curso()], umaLinha)
      await expect(svc.returnToDraft('c1', 'Aula 1 sem áudio.')).resolves.toMatchObject({ status: 'draft' })
      withQueryResults(db, [curso({ status: 'published' })], undefined)
      await expect(svc.takedown('c1', 'Direitos autorais.')).resolves.toMatchObject({ status: 'draft' })
    })
  })

  describe('decisões', () => {
    it('devolve só o necessário para o log: id, título, polo e o status novo', async () => {
      expect(await aprovaDireito(svc, db, curso())).toEqual({ id: 'c1', title: 'Excel', tenantId: 't-a', status: 'published' })
      withQueryResults(db, [curso()])
      expect(await svc.returnToDraft('c1', 'Aula 1 sem áudio.')).toEqual({ id: 'c1', title: 'Excel', tenantId: 't-a', status: 'draft' })
      withQueryResults(db, [curso({ status: 'published' })])
      expect(await svc.takedown('c1', 'Direitos autorais.')).toEqual({ id: 'c1', title: 'Excel', tenantId: 't-a', status: 'draft' })
    })

    it('devolver grava o motivo sem espaços nas pontas e mantém a data de envio e a primeira aprovação', async () => {
      withQueryResults(db, [curso({ approvedAt: new Date('2026-09-01T00:00:00Z') })])
      await svc.returnToDraft('c1', '  A aula 1 está sem áudio.  ')
      const set = db.set.mock.calls[0][0]
      expect(set).toMatchObject({ status: 'draft', reviewNote: 'A aula 1 está sem áudio.' })
      expect(set).not.toHaveProperty('approvedAt')
      expect(set).not.toHaveProperty('submittedAt')
    })

    it('o motivo tem de 3 a 1000 caracteres, contados sem os espaços das pontas', async () => {
      await expect(svc.returnToDraft('c1', 'ab')).rejects.toThrow('Escreva o motivo (3 a 1000 caracteres).')
      await expect(svc.takedown('c1', 'a'.repeat(1001))).rejects.toThrow('Escreva o motivo (3 a 1000 caracteres).')
      await expect(svc.returnToDraft('c1', `  ${'a'.repeat(1001)}  `)).rejects.toThrow('Escreva o motivo')
      // sem consulta ao banco: o motivo é conferido antes de procurar o curso
      expect(db.select).not.toHaveBeenCalled()
      withQueryResults(db, [curso()])
      await expect(svc.returnToDraft('c1', 'abc')).resolves.toMatchObject({ status: 'draft' })
      withQueryResults(db, [curso()])
      await expect(svc.returnToDraft('c1', 'a'.repeat(1000))).resolves.toMatchObject({ status: 'draft' })
    })

    it('tirar do ar só vale para curso publicado; devolver e aprovar, só para curso em análise', async () => {
      for (const status of ['draft', 'in_review', 'archived']) {
        withQueryResults(db, [curso({ status })])
        await expect(svc.takedown('c1', 'Direitos autorais.')).rejects.toMatchObject({ response: expect.objectContaining({ code: 'INVALID_TRANSITION' }) })
      }
      for (const status of ['draft', 'published', 'archived']) {
        withQueryResults(db, [curso({ status })])
        await expect(svc.approve('u-plat', 'c1', 'qualquer')).rejects.toMatchObject({ response: expect.objectContaining({ code: 'INVALID_TRANSITION' }) })
        withQueryResults(db, [curso({ status })])
        await expect(svc.returnToDraft('c1', 'Aula 1 sem áudio.')).rejects.toMatchObject({ response: expect.objectContaining({ code: 'INVALID_TRANSITION' }) })
      }
      // nenhuma recusa chegou a gravar
      expect(db.update).not.toHaveBeenCalled()
    })

    it('curso inexistente também é 404 para devolver e tirar do ar', async () => {
      withQueryResults(db, [])
      await expect(svc.returnToDraft('x', 'Aula 1 sem áudio.')).rejects.toThrow('Curso não encontrado.')
      withQueryResults(db, [])
      await expect(svc.takedown('x', 'Direitos autorais.')).rejects.toThrow('Curso não encontrado.')
    })

    it('a decisão grava só o curso pedido', async () => {
      await aprovaDireito(svc, db, curso({ id: 'c9' }))
      // o último where é o do UPDATE (o primeiro é o da leitura do curso)
      const wheres = allWheres(db.where)
      expect(wheres[0]).toEqual({ sql: '`courses`.`id` = ?', params: ['c9'] })
      expect(wheres[wheres.length - 1].params.slice(0, 3)).toEqual(['c9', 't-a', 'in_review'])
    })
  })

  describe('a primeira aprovação congela a carga horária (a mesma regra do setStatus)', () => {
    it('sem carga definida, grava a soma das aulas arredondada na MESMA gravação da aprovação', async () => {
      // 7200 s + 5760 s = 3,6 h, arredondado para 4: o certificado vai imprimir este número.
      await aprovaDireito(svc, db, curso({ workloadHours: null }), '12960')
      expect(db.update).toHaveBeenCalledTimes(1)
      expect(db.set).toHaveBeenCalledWith(expect.objectContaining({
        status: 'published', approvedAt: expect.any(Date), approvedBy: 'u-plat', workloadHours: 4,
      }))
    })

    it('a soma é a das aulas do curso aprovado', async () => {
      await aprovaDireito(svc, db, curso({ id: 'c7', workloadHours: null }), '7200')
      // [0] leitura do curso, [1] há aula?, [2] soma das aulas, [3] UPDATE
      expect(allWheres(db.where)[1]).toEqual({ sql: '`modules`.`course_id` = ?', params: ['c7'] })
      expect(allWheres(db.where)[2]).toEqual({ sql: '`modules`.`course_id` = ?', params: ['c7'] })
    })

    it('carga zero conta como não definida, como no certificado', async () => {
      await aprovaDireito(svc, db, curso({ workloadHours: 0 }), '7200')
      expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ workloadHours: 2 }))
    })

    it('a carga definida pelo polo vence a soma e nada é trocado', async () => {
      await aprovaDireito(svc, db, curso({ workloadHours: 180 }), '7200')
      expect(db.set.mock.calls[0][0]).not.toHaveProperty('workloadHours')
    })

    it('curso sem duração nas aulas fica com o piso de 1 hora, nunca 0', async () => {
      await aprovaDireito(svc, db, curso({ workloadHours: null }), null)
      expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ workloadHours: 1 }))
    })

    it('só a primeira aprovação congela: reaprovar confere a soma (a versão da fila depende dela) e não mexe na carga', async () => {
      const primeira = new Date('2026-09-01T00:00:00Z')
      await aprovaDireito(svc, db, curso({ approvedAt: primeira, approvedBy: 'u-antigo', publishedAt: primeira, workloadHours: null }))
      expect(db.select).toHaveBeenCalledTimes(3)
      expect(db.set.mock.calls[0][0]).not.toHaveProperty('workloadHours')
    })

    it('uma recusa não consulta a soma nem grava', async () => {
      withQueryResults(db, [curso({ status: 'draft', workloadHours: null })])
      await expect(svc.approve('u-plat', 'c1', 'qualquer')).rejects.toMatchObject({ response: expect.objectContaining({ code: 'INVALID_TRANSITION' }) })
      expect(db.select).toHaveBeenCalledTimes(1)
      expect(db.update).not.toHaveBeenCalled()
    })

    it('devolver e tirar do ar não congelam nada', async () => {
      withQueryResults(db, [curso({ workloadHours: null })])
      await svc.returnToDraft('c1', 'Aula 1 sem áudio.')
      withQueryResults(db, [curso({ status: 'published', approvedAt: new Date(), workloadHours: null })])
      await svc.takedown('c1', 'Direitos autorais.')
      for (const [set] of db.set.mock.calls) expect(set).not.toHaveProperty('workloadHours')
      expect(db.select).toHaveBeenCalledTimes(2)
    })
  })

  describe('cursos de todos os polos (modelos de certificado)', () => {
    it('sem busca: todos os polos, matriz primeiro, depois polo e título, até 200', async () => {
      withQueryResults(db, [{ id: 'c1', title: 'Excel', slug: 'excel', tenantId: 't-a', tenantName: 'Polo A', status: 'draft', certificateTemplateId: undefined }])
      expect(await svc.listCourses()).toEqual([{ id: 'c1', title: 'Excel', slug: 'excel', tenantId: 't-a', tenantName: 'Polo A', status: 'draft', certificateTemplateId: null }])
      expect(db.where).not.toHaveBeenCalled()
      expect((db.orderBy.mock.calls[0] as unknown[]).map((o) => renderSql(o).sql)).toEqual([
        '`tenants`.`is_matriz` desc', '`tenants`.`name` asc', '`courses`.`title` asc', '`courses`.`id` asc',
      ])
      expect(db.limit).toHaveBeenCalledWith(200)
    })

    it('busca por título com os curingas do LIKE como texto', async () => {
      withQueryResults(db, [])
      await svc.listCourses('  50%_off\\  ')
      expect(allWheres(db.where)).toEqual([{ sql: '`courses`.`title` like ?', params: ['%50\\%\\_off\\\\%'] }])
    })

    it('busca vazia, só espaços ou que não é texto (q repetido na URL) vale como sem busca', async () => {
      for (const q of ['', '   ', ['a', 'b'], 42]) {
        const outro = createDrizzleMock()
        withQueryResults(outro, [])
        await new PlatformReviewService(outro as never, tenants as never).listCourses(q)
        expect(outro.where).not.toHaveBeenCalled()
      }
    })
  })

  describe('fila de aprovação', () => {
    const linha = (course: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
      course: curso(course), tenantName: 'Polo A', tenantSlug: 'polo-a', tenantIsMatriz: false, instructorName: 'Prof. A', ...over,
    })

    it('fila vazia: uma consulta só e nada mais', async () => {
      withQueryResults(db, [])
      expect(await svc.queue()).toEqual([])
      expect(db.select).toHaveBeenCalledTimes(1)
    })

    it('só entra curso em análise, do mais antigo para o mais novo, com desempate pelo id', async () => {
      withQueryResults(db, [])
      await svc.queue()
      expect(allWheres(db.where)).toEqual([{ sql: '`courses`.`status` = ?', params: ['in_review'] }])
      expect(db.orderBy).toHaveBeenCalledTimes(1)
      expect((db.orderBy.mock.calls[0] as unknown[]).map((o) => renderSql(o).sql)).toEqual(['`courses`.`submitted_at` asc', '`courses`.`id` asc'])
      expect(db.innerJoin).toHaveBeenCalledTimes(1)
      expect(db.leftJoin).toHaveBeenCalledTimes(1)
    })

    it('monta o item com o polo, o instrutor, o currículo resumido e o link do editor no site do polo', async () => {
      withQueryResults(
        db,
        [linha({ id: 'c1', title: 'Excel', submittedAt: new Date('2026-10-01T10:00:00Z'), workloadHours: 40, coordinatorName: 'Ana' })],
        [{ courseId: 'c1', n: 2 }],
        [{ courseId: 'c1', n: 5 }],
        [{ courseId: 'c1', dur: '7200' }]
      )
      expect(await svc.queue()).toEqual([{
        courseId: 'c1', title: 'Excel', tenantId: 't-a', tenantName: 'Polo A', tenantSlug: 'polo-a', instructorName: 'Prof. A',
        submittedAt: '2026-10-01T10:00:00.000Z', moduleCount: 2, lessonCount: 5, workloadHours: 40, workloadIsComputed: false,
        coordinatorName: 'Ana', coordinatorRole: null, hasCoordinatorSignature: false, firstApproval: true, reviewNote: null,
        fingerprint: versao({ title: 'Excel', workloadHours: 40, coordinatorName: 'Ana' }, 7200),
        editorUrl: 'https://polo-a.cursos.studiopilari.com.br/instrutor/curso/c1',
      }])
    })

    it('mostra o cargo, se há assinatura (sem o caminho), se é a primeira aprovação e a nota anterior', async () => {
      const aprovadoEm = new Date('2026-09-01T00:00:00Z')
      withQueryResults(
        db,
        [
          linha({ id: 'c1', coordinatorName: 'Ana', coordinatorRole: 'Coordenadora', coordinatorSignaturePath: 'cursos/c1/signature/ana.png', reviewNote: 'Falta a ementa.' }),
          linha({ id: 'c2', approvedAt: aprovadoEm }),
        ],
        [], [], []
      )
      const [primeiro, segundo] = await svc.queue()
      expect(primeiro).toMatchObject({ coordinatorRole: 'Coordenadora', hasCoordinatorSignature: true, firstApproval: true, reviewNote: 'Falta a ementa.' })
      expect(JSON.stringify(primeiro)).not.toContain('ana.png')
      expect(segundo).toMatchObject({ coordinatorRole: null, hasCoordinatorSignature: false, firstApproval: false, reviewNote: null })
    })

    it('curso da matriz abre o editor no endereço da matriz', async () => {
      withQueryResults(
        db,
        [linha({ id: 'c2' }, { tenantName: 'Studio Pilari', tenantSlug: 'pilari', tenantIsMatriz: true })],
        [], [], []
      )
      const [item] = await svc.queue()
      expect(item.editorUrl).toBe('https://cursos.studiopilari.com.br/instrutor/curso/c2')
      expect(tenants.siteUrl).toHaveBeenLastCalledWith({ slug: 'pilari', isMatriz: true })
    })

    it('instrutor ausente, envio sem data e coordenador sem nome viram null; curso sem aula e sem módulo vale zero', async () => {
      withQueryResults(db, [linha({ id: 'c3', submittedAt: null, coordinatorName: undefined }, { instructorName: null })], [], [], [])
      const [item] = await svc.queue()
      expect(item).toMatchObject({ instructorName: null, submittedAt: null, coordinatorName: null, moduleCount: 0, lessonCount: 0 })
    })

    it('sem carga definida mostra a soma das aulas que a aprovação vai gravar, marcada como calculada', async () => {
      withQueryResults(
        db,
        [linha({ id: 'c1', workloadHours: null })],
        [{ courseId: 'c1', n: 2 }],
        [{ courseId: 'c1', n: 2 }],
        [{ courseId: 'c1', dur: '12960' }]
      )
      const [item] = await svc.queue()
      expect(item).toMatchObject({ workloadHours: 4, workloadIsComputed: true })
    })

    it('carga zero conta como não definida e aparece calculada; sem duração nenhuma, o piso é 1 hora', async () => {
      withQueryResults(
        db,
        [linha({ id: 'c1', workloadHours: 0 }), linha({ id: 'c2', workloadHours: null })],
        [], [], [{ courseId: 'c1', dur: '7200' }]
      )
      const itens = await svc.queue()
      expect(itens[0]).toMatchObject({ courseId: 'c1', workloadHours: 2, workloadIsComputed: true })
      expect(itens[1]).toMatchObject({ courseId: 'c2', workloadHours: 1, workloadIsComputed: true })
    })

    it('a carga definida pelo polo vence a soma e não vem marcada como calculada', async () => {
      withQueryResults(db, [linha({ id: 'c1', workloadHours: 180 })], [], [], [{ courseId: 'c1', dur: '7200' }])
      expect((await svc.queue())[0]).toMatchObject({ workloadHours: 180, workloadIsComputed: false })
    })

    it('com vários cursos continua em quatro consultas (cursos, módulos, aulas, durações), sem consulta por linha', async () => {
      withQueryResults(
        db,
        [linha({ id: 'c1', workloadHours: null }), linha({ id: 'c2', workloadHours: 40 }, { tenantName: 'Polo B', tenantSlug: 'polo-b' }), linha({ id: 'c3', workloadHours: null })],
        [{ courseId: 'c1', n: 1 }, { courseId: 'c2', n: 3 }],
        [{ courseId: 'c1', n: 1 }, { courseId: 'c3', n: 4 }],
        [{ courseId: 'c1', dur: '3600' }, { courseId: 'c3', dur: '36000' }]
      )
      const itens = await svc.queue()
      expect(db.select).toHaveBeenCalledTimes(4)
      expect(db.groupBy).toHaveBeenCalledTimes(3)
      expect(allWheres(db.where).slice(1)).toEqual([
        { sql: '`modules`.`course_id` in (?, ?, ?)', params: ['c1', 'c2', 'c3'] },
        { sql: '`modules`.`course_id` in (?, ?, ?)', params: ['c1', 'c2', 'c3'] },
        { sql: '`modules`.`course_id` in (?, ?, ?)', params: ['c1', 'c2', 'c3'] },
      ])
      expect(itens.map((i) => [i.courseId, i.tenantName, i.moduleCount, i.lessonCount, i.workloadHours, i.workloadIsComputed])).toEqual([
        ['c1', 'Polo A', 1, 1, 1, true],
        ['c2', 'Polo B', 3, 0, 40, false],
        ['c3', 'Polo A', 0, 4, 10, true],
      ])
    })

    it('a fila mostra exatamente a carga que a aprovação grava, e a aprovação aceita o fingerprint dela', async () => {
      const aulas: unknown[] = [{ courseId: 'c1', dur: '12960' }]
      withQueryResults(db, [linha({ id: 'c1', workloadHours: null })], [], [], aulas)
      const [item] = await svc.queue()

      const outro = createDrizzleMock()
      const aprovador = new PlatformReviewService(outro as never, tenants as never)
      withQueryResults(outro, ...leiturasDaAprovacao(curso({ id: 'c1', workloadHours: null }), '12960'))
      await aprovador.approve('u-plat', 'c1', item.fingerprint)
      expect(outro.set).toHaveBeenCalledWith(expect.objectContaining({ workloadHours: item.workloadHours }))
    })
  })
})
