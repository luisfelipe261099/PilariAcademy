/// <reference types="jest" />
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { createDrizzleMock, withQueryResults, type DrizzleMock } from '../../__test-utils__/drizzle-mock'
import { allWheres } from '../../__test-utils__/sql'
import type { Actor } from '../../common/types/actor.type'
import { CourseScopeService } from '../tenancy/course-scope.service'
import { AuthoringService } from './authoring.service'

function make() {
  const db: DrizzleMock = createDrizzleMock()
  // GcsService: resolve o anexo para uma URL baixável (aqui devolve o próprio valor).
  const gcs = { playableUrl: jest.fn(async (v: string | null) => v) }
  // O escopo é o REAL, sobre o mesmo mock: `scope.byId` faz a mesma consulta única do antigo
  // `ownedCourse`, então a fila de resultados de cada teste continua valendo.
  return { db, service: new AuthoringService(db as never, gcs as never, new CourseScopeService(db as never)) }
}

/** Quem age: por padrão, o instrutor DONO do `courseRow`, no polo `t-a`. */
const ator = (over: Partial<Actor> = {}): Actor => ({ uid: 'prof', tenantId: 't-a', isMatriz: false, isAdmin: false, isPlatformAdmin: false, ...over })
/** Admin do polo `t-a` que NÃO é o dono do curso (a posse não pode ser o motivo de ele passar). */
const admin = (over: Partial<Actor> = {}): Actor => ator({ uid: 'admin-uid', isAdmin: true, ...over })

const courseRow = {
  id: 'c1', tenantId: 't-a', slug: 'curso', instructorId: 'prof', categoryId: null, kind: 'online', title: 'Curso',
  subtitle: null, description: null, priceInCents: 0, coverImageUrl: null, status: 'draft',
  externalUrl: null, publishedAt: null,
}

describe('AuthoringService', () => {
  it('create gera slug e cria draft', async () => {
    const { db, service } = make()
    withQueryResults(db, [], undefined, [{ ...courseRow, slug: 'meu-curso', title: 'Meu Curso' }])
    const c = await service.create(ator(), { title: 'Meu Curso' })
    expect(c.status).toBe('draft')
    expect(c.slug).toBe('meu-curso')
    expect(db.insert).toHaveBeenCalled()
  })

  it('listMine traz os cursos do instrutor neste polo', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    await service.listMine(ator())
    expect(allWheres(db.where)[0]).toEqual({ sql: '(`courses`.`instructor_id` = ? and `courses`.`tenant_id` = ?)', params: ['prof', 't-a'] })
  })

  it('create grava o curso no polo do ator, com slug único no polo', async () => {
    const { db, service } = make()
    withQueryResults(db, [], undefined, [{ id: 'c-novo', tenantId: 't-a', slug: 'excel', title: 'Excel', status: 'draft' }])
    await service.create(ator(), { title: 'Excel' })
    expect(allWheres(db.where)[0].params).toEqual(['t-a', 'excel'])
    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-a', instructorId: 'prof', slug: 'excel' }))
  })

  it('create recusa categoria de outro polo', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    await expect(service.create(ator(), { title: 'Excel', categoryId: 'cat-de-outro' })).rejects.toThrow(BadRequestException)
    // a categoria foi procurada DENTRO do polo do ator, e nada foi gravado
    expect(allWheres(db.where)[0]).toEqual({ sql: '(`categories`.`id` = ? and `categories`.`tenant_id` = ?)', params: ['cat-de-outro', 't-a'] })
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('create aceita categoria do próprio polo', async () => {
    const { db, service } = make()
    withQueryResults(db, [{ id: 'cat-a' }], [], undefined, [{ ...courseRow, categoryId: 'cat-a' }])
    const c = await service.create(ator(), { title: 'Excel', categoryId: 'cat-a' })
    expect(c.categoryId).toBe('cat-a')
    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-a', categoryId: 'cat-a' }))
  })

  it('curso de outro polo vira 404 em qualquer operação', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    await expect(service.getDetail(ator({ isAdmin: true }), 'c-de-outro')).rejects.toThrow(NotFoundException)
  })

  it('getDetail de curso alheio → 403', async () => {
    const { db, service } = make()
    withQueryResults(db, [{ ...courseRow, instructorId: 'outro' }])
    await expect(service.getDetail(ator(), 'c1')).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('getOne admin abre curso alheio (ownership ignorada)', async () => {
    const { db, service } = make()
    withQueryResults(db, [{ ...courseRow, instructorId: 'outro' }], [{ n: 2 }], [{ n: 5 }])
    const c = await service.getOne(admin(), 'c1')
    expect(c.id).toBe('c1')
    expect(c.moduleCount).toBe(2)
    expect(c.lessonCount).toBe(5)
  })

  it('getOne de curso de outro polo → 404, mesmo para admin', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    await expect(service.getOne(admin(), 'c-de-outro')).rejects.toThrow(NotFoundException)
    expect(allWheres(db.where)[0]).toEqual({ sql: '(`courses`.`tenant_id` = ? and `courses`.`id` = ?)', params: ['t-a', 'c-de-outro'] })
  })

  it('remove (admin) apaga o curso e dependências em cascata', async () => {
    const { db, service } = make()
    const curso = { ...courseRow, instructorId: 'outro' }
    // [posse], [curso travado], [certificado?], [matrícula?], [módulos], [aulas]
    withQueryResults(db, [curso], [curso], [], [], [{ id: 'm1' }], [{ id: 'l1' }])
    expect(await service.remove(admin(), 'c1')).toMatchObject({ id: 'c1', title: 'Curso', tenantId: 't-a' })
    expect(db.delete).toHaveBeenCalled()
    // o último DELETE é o do próprio curso, e ele também carrega o polo
    const wheres = allWheres(db.where)
    expect(wheres[wheres.length - 1]).toEqual({ sql: '(`courses`.`id` = ? and `courses`.`tenant_id` = ?)', params: ['c1', 't-a'] })
    // o certificado nunca entra na cascata
    expect(wheres.some((w) => w.sql.includes('`certificates`') && w.sql !== '`certificates`.`course_id` = ?')).toBe(false)
  })

  it('remove: a conferência e a cascata são uma transação, com a linha do curso travada e a história lida com trava', async () => {
    const { db, service } = make()
    withQueryResults(db, [courseRow], [courseRow], [], [], [], [])
    await service.remove(ator(), 'c1')
    expect(db.transaction).toHaveBeenCalledTimes(1)
    // a leitura travada do curso (2ª consulta) e as duas da história
    expect(db.for.mock.calls.map((c: unknown[]) => c[0])).toEqual(['update', 'share', 'share'])
    expect(allWheres(db.where)[1]).toEqual({ sql: '(`courses`.`id` = ? and `courses`.`tenant_id` = ?)', params: ['c1', 't-a'] })
  })

  it('remove: o curso sumiu entre a posse e a trava (outra exclusão) → 404 e nada é apagado', async () => {
    const { db, service } = make()
    withQueryResults(db, [courseRow], [])
    await expect(service.remove(ator(), 'c1')).rejects.toThrow(NotFoundException)
    expect(db.delete).not.toHaveBeenCalled()
  })

  describe('remove: curso com história não se apaga', () => {
    /** 409 COURSE_HAS_HISTORY com a mensagem dada, e nada apagado. */
    async function barrado(promise: Promise<unknown>, db: DrizzleMock, message: string) {
      const erro = await promise.then(() => null, (e: unknown) => e)
      expect(erro).toBeInstanceOf(ConflictException)
      expect((erro as ConflictException).getResponse()).toEqual({ statusCode: 409, code: 'COURSE_HAS_HISTORY', message })
      expect(db.delete).not.toHaveBeenCalled()
    }
    const POLO = 'Este curso já foi aprovado ou tem alunos e não pode ser excluído. Tire o curso do ar.'
    const PLATAFORMA = 'Este curso tem certificados emitidos e não pode ser excluído. Tire o curso do ar.'
    const plataforma = () => admin({ uid: 'u-plat', isPlatformAdmin: true })

    it('para o polo (admin ou instrutor dono): curso já aprovado', async () => {
      for (const quem of [admin(), ator()]) {
        const { db, service } = make()
        const aprovado = { ...courseRow, approvedAt: new Date() }
        withQueryResults(db, [aprovado], [aprovado], [])
        await barrado(service.remove(quem, 'c1'), db, POLO)
      }
    })

    it('para o polo: curso com matrícula (de qualquer situação) ou com certificado', async () => {
      const matricula = make()
      withQueryResults(matricula.db, [courseRow], [courseRow], [], [{ id: 'e1' }])
      await barrado(matricula.service.remove(ator(), 'c1'), matricula.db, POLO)
      expect(allWheres(matricula.db.where)[3]).toEqual({ sql: '`enrollments`.`course_id` = ?', params: ['c1'] })

      const certificado = make()
      withQueryResults(certificado.db, [courseRow], [courseRow], [{ id: 'cert1' }])
      await barrado(certificado.service.remove(admin(), 'c1'), certificado.db, POLO)
      expect(allWheres(certificado.db.where)[2]).toEqual({ sql: '`certificates`.`course_id` = ?', params: ['c1'] })
    })

    it('a plataforma exclui curso aprovado e com aluno, sem nem consultar as matrículas', async () => {
      const { db, service } = make()
      const aprovado = { ...courseRow, approvedAt: new Date() }
      withQueryResults(db, [aprovado], [aprovado], [], [{ id: 'm1' }], [{ id: 'l1' }])
      await service.remove(plataforma(), 'c1')
      expect(db.delete).toHaveBeenCalled()
      // posse, curso travado, certificado?, módulos e aulas: nenhuma consulta de matrícula
      expect(db.select).toHaveBeenCalledTimes(5)
    })

    it('a plataforma não exclui curso com certificado', async () => {
      const { db, service } = make()
      const aprovado = { ...courseRow, approvedAt: new Date() }
      withQueryResults(db, [aprovado], [aprovado], [{ id: 'cert1' }])
      await barrado(service.remove(plataforma(), 'c1'), db, PLATAFORMA)
    })
  })

  it('remove de curso de outro polo → 404 e nada é apagado', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    await expect(service.remove(admin(), 'c-de-outro')).rejects.toThrow(NotFoundException)
    expect(db.delete).not.toHaveBeenCalled()
  })

  it('reorderModules grava order na ordem dada', async () => {
    const { db, service } = make()
    withQueryResults(db, [courseRow], undefined, undefined)
    await service.reorderModules(ator(), 'c1', ['m2', 'm1'])
    expect(db.update).toHaveBeenCalledTimes(2)
  })

  it('publicar sem nenhuma aula → 400 (mesmo o admin da plataforma)', async () => {
    const { db, service } = make()
    withQueryResults(db, [courseRow], [])
    await expect(service.setStatus(admin({ isPlatformAdmin: true }), 'c1', 'published')).rejects.toBeInstanceOf(BadRequestException)
    expect(db.update).not.toHaveBeenCalled()
  })

  describe('setStatus (aprovação do Studio Pilari)', () => {
    /** Falha esperada da política: status HTTP e `code` estável no corpo, e nada gravado. */
    async function negado(promise: Promise<unknown>, tipo: typeof ForbiddenException | typeof BadRequestException, code: string) {
      const erro = await promise.then(() => null, (e: unknown) => e)
      expect(erro).toBeInstanceOf(tipo)
      expect((erro as ForbiddenException).getResponse()).toMatchObject({ code })
    }

    it('instrutor NÃO publica direto → 403 APPROVAL_REQUIRED e nada é gravado', async () => {
      const { db, service } = make()
      withQueryResults(db, [courseRow])
      await negado(service.setStatus(ator(), 'c1', 'published'), ForbiddenException, 'APPROVAL_REQUIRED')
      expect(db.update).not.toHaveBeenCalled()
    })

    it('instrutor também não arquiva → 403 FORBIDDEN', async () => {
      const { db, service } = make()
      withQueryResults(db, [courseRow])
      await negado(service.setStatus(ator(), 'c1', 'archived'), ForbiddenException, 'FORBIDDEN')
      expect(db.update).not.toHaveBeenCalled()
    })

    it('instrutor envia para revisão (com aula) → in_review', async () => {
      const { db, service } = make()
      withQueryResults(db, [courseRow], [{ id: 'l1' }], undefined)
      const r = await service.setStatus(ator(), 'c1', 'in_review')
      expect(r.status).toBe('in_review')
      expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'in_review' }))
    })

    it('enviar para revisão sem aula → 400', async () => {
      const { db, service } = make()
      withQueryResults(db, [courseRow], [])
      await expect(service.setStatus(ator(), 'c1', 'in_review')).rejects.toBeInstanceOf(BadRequestException)
    })

    it('envio para análise grava submittedAt e MANTÉM a nota de revisão', async () => {
      const { db, service } = make()
      withQueryResults(
        db,
        [{ id: 'c1', tenantId: 't-a', instructorId: 'prof', status: 'draft', approvedAt: new Date(), reviewNote: 'Aula 3 sem áudio.', publishedAt: null }],
        [{ id: 'l1' }]
      )
      await service.setStatus(ator(), 'c1', 'in_review')
      expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'in_review', submittedAt: expect.any(Date) }))
      // a nota só some quando o Studio Pilari aprova de novo: nem a chave vai no UPDATE
      expect(db.set.mock.calls[0][0]).not.toHaveProperty('reviewNote')
    })

    it('só rascunho vai para análise → 400 INVALID_TRANSITION e nada é gravado', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ ...courseRow, status: 'published', approvedAt: new Date() }])
      await negado(service.setStatus(ator(), 'c1', 'in_review'), BadRequestException, 'INVALID_TRANSITION')
      expect(db.update).not.toHaveBeenCalled()
    })

    it('admin DO POLO não aprova a primeira publicação → 403 APPROVAL_REQUIRED e nada é gravado', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ ...courseRow, status: 'in_review' }])
      await negado(service.setStatus(admin(), 'c1', 'published'), ForbiddenException, 'APPROVAL_REQUIRED')
      expect(db.update).not.toHaveBeenCalled()
    })

    it('admin da plataforma aprova (in_review → published): carimba publishedAt, approvedAt e approvedBy', async () => {
      const { db, service } = make()
      // [curso], [há aula?], [soma da duração das aulas: a primeira aprovação congela a carga], [UPDATE]
      withQueryResults(db, [{ ...courseRow, status: 'in_review' }], [{ id: 'l1' }], [{ dur: '7200' }], undefined)
      const r = await service.setStatus(admin({ uid: 'u-plat', isPlatformAdmin: true }), 'c1', 'published')
      expect(r.status).toBe('published')
      expect(db.set).toHaveBeenCalledWith(expect.objectContaining({
        status: 'published', publishedAt: expect.any(Date), approvedAt: expect.any(Date), approvedBy: 'u-plat', reviewNote: null,
      }))
    })

    it('admin da matriz publica direto e a publicação já conta como aprovação', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ ...courseRow, tenantId: 't-m' }], [{ id: 'l1' }], [{ dur: '7200' }], undefined)
      await service.setStatus(admin({ uid: 'adm-m', tenantId: 't-m', isMatriz: true }), 'c1', 'published')
      expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'published', approvedAt: expect.any(Date), approvedBy: 'adm-m', workloadHours: 2 }))
    })

    it('instrutor da matriz (sem ser admin) continua sem publicar', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ ...courseRow, tenantId: 't-m' }])
      await negado(service.setStatus(ator({ tenantId: 't-m', isMatriz: true }), 'c1', 'published'), ForbiddenException, 'APPROVAL_REQUIRED')
      expect(db.update).not.toHaveBeenCalled()
    })

    it('admin do polo republica curso já aprovado sem regravar a aprovação', async () => {
      const aprovadoEm = new Date('2026-09-01T00:00:00Z')
      const { db, service } = make()
      withQueryResults(db, [{ ...courseRow, approvedAt: aprovadoEm, publishedAt: aprovadoEm }], [{ id: 'l1' }], undefined)
      const r = await service.setStatus(admin(), 'c1', 'published')
      expect(r.status).toBe('published')
      const set = db.set.mock.calls[0][0]
      expect(set).toMatchObject({ status: 'published', publishedAt: aprovadoEm })
      expect(set).not.toHaveProperty('approvedAt')
      expect(set).not.toHaveProperty('approvedBy')
      expect(set).not.toHaveProperty('submittedAt')
      // republicar não é aprovar: não mexe na nota nem na carga horária
      expect(set).not.toHaveProperty('reviewNote')
      expect(set).not.toHaveProperty('workloadHours')
    })

    it('curso devolvido pelo Studio Pilari: o admin do polo não republica sem nova análise', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ ...courseRow, approvedAt: new Date(), reviewNote: 'Aula 3 sem áudio.' }])
      const erro = await service.setStatus(admin(), 'c1', 'published').then(() => null, (e: unknown) => e)
      expect(erro).toBeInstanceOf(ForbiddenException)
      expect((erro as ForbiddenException).getResponse()).toMatchObject({
        statusCode: 403, code: 'APPROVAL_REQUIRED', message: expect.stringContaining('O Studio Pilari pediu ajustes'),
      })
      expect(db.update).not.toHaveBeenCalled()
    })

    it('a plataforma republica curso devolvido e a nota some', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ ...courseRow, approvedAt: new Date(), reviewNote: 'Aula 3 sem áudio.' }], [{ id: 'l1' }], undefined)
      await service.setStatus(admin({ isPlatformAdmin: true }), 'c1', 'published')
      expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'published', reviewNote: null }))
    })

    it('reenviar curso devolvido para análise NÃO limpa a nota do Studio Pilari', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ ...courseRow, approvedAt: new Date(), reviewNote: 'Aula 3 sem áudio.' }], [{ id: 'l1' }], undefined)
      await service.setStatus(ator(), 'c1', 'in_review')
      const set = db.set.mock.calls[0][0]
      expect(set).toMatchObject({ status: 'in_review', submittedAt: expect.any(Date) })
      expect(set).not.toHaveProperty('reviewNote')
    })

    it('o admin do polo também não limpa a nota: nem enviando para análise, nem republicando', async () => {
      const a = make()
      withQueryResults(a.db, [{ ...courseRow, approvedAt: new Date(), reviewNote: 'Aula 3 sem áudio.' }], [{ id: 'l1' }], undefined)
      await a.service.setStatus(admin(), 'c1', 'in_review')
      expect(a.db.set.mock.calls[0][0]).not.toHaveProperty('reviewNote')

      const b = make()
      withQueryResults(b.db, [{ ...courseRow, approvedAt: new Date(), reviewNote: 'Aula 3 sem áudio.' }])
      await expect(b.service.setStatus(admin(), 'c1', 'published')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'APPROVAL_REQUIRED', message: expect.stringContaining('O Studio Pilari pediu ajustes') }),
      })
      expect(b.db.update).not.toHaveBeenCalled()
    })

    it('o admin da matriz que publica curso devolvido da matriz também apaga a nota', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ ...courseRow, tenantId: 't-m', approvedAt: new Date(), reviewNote: 'Revise o módulo 2.' }], [{ id: 'l1' }], undefined)
      await service.setStatus(admin({ tenantId: 't-m', isMatriz: true }), 'c1', 'published')
      expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'published', reviewNote: null }))
    })

    it('voltar para rascunho é livre e não apaga a nota do Studio Pilari', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ ...courseRow, status: 'in_review', reviewNote: 'Ajuste o título.' }], undefined)
      await service.setStatus(ator(), 'c1', 'draft')
      const set = db.set.mock.calls[0][0]
      expect(set).toMatchObject({ status: 'draft' })
      expect(set).not.toHaveProperty('reviewNote')
    })

    it('admin do polo arquiva curso aprovado', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ ...courseRow, status: 'published', approvedAt: new Date() }], undefined)
      const r = await service.setStatus(admin(), 'c1', 'archived')
      expect(r.status).toBe('archived')
    })

    it('instrutor pode despublicar (published → draft)', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ ...courseRow, status: 'published', publishedAt: new Date() }], undefined)
      const r = await service.setStatus(ator(), 'c1', 'draft')
      expect(r.status).toBe('draft')
    })

    it('a troca de status devolve o registro do log com o título do curso e as situações em português', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ ...courseRow, title: 'Excel', status: 'published', approvedAt: new Date() }], undefined)
      expect(await service.setStatus(admin(), 'c1', 'archived')).toEqual({
        status: 'archived', log: { courseId: 'c1', action: 'course.status', summary: 'Curso "Excel": publicado → arquivado' },
      })
    })

    it('a gravação do status filtra pelo polo e pela situação lida', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ ...courseRow, status: 'published' }], undefined)
      await service.setStatus(ator(), 'c1', 'draft')
      const wheres = allWheres(db.where)
      expect(wheres[wheres.length - 1]).toEqual({
        sql: '(`courses`.`id` = ? and `courses`.`tenant_id` = ? and `courses`.`status` = ?)', params: ['c1', 't-a', 'published'],
      })
    })

    it('corrida: o UPDATE não atingiu linha (o curso mudou de situação depois da leitura) → 400 INVALID_TRANSITION', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ ...courseRow, status: 'published', approvedAt: new Date() }], [{ affectedRows: 0 }])
      const erro = await service.setStatus(admin(), 'c1', 'archived').then(() => null, (e: unknown) => e)
      expect(erro).toBeInstanceOf(BadRequestException)
      expect((erro as BadRequestException).getResponse()).toEqual({
        statusCode: 400, code: 'INVALID_TRANSITION', message: 'O curso mudou de situação enquanto você decidia. Recarregue a página.',
      })
    })

    it('sem aula, o envio e a publicação respondem 400 COURSE_WITHOUT_LESSONS', async () => {
      const { db, service } = make()
      withQueryResults(db, [courseRow], [])
      await negado(service.setStatus(ator(), 'c1', 'in_review'), BadRequestException, 'COURSE_WITHOUT_LESSONS')
      expect(db.update).not.toHaveBeenCalled()
    })

    it('curso de outro polo → 404, mesmo para admin, e nada é gravado', async () => {
      const { db, service } = make()
      withQueryResults(db, [])
      await expect(service.setStatus(admin(), 'c-de-outro', 'published')).rejects.toThrow(NotFoundException)
      expect(db.update).not.toHaveBeenCalled()
    })

    describe('o status em que o curso já está', () => {
      // Repetir o status não é transição: não confere aula, não grava nada e, por isso, não pode apagar a nota.
      it('devolve o status sem conferir aulas e sem gravar', async () => {
        const { db, service } = make()
        withQueryResults(db, [{ ...courseRow, status: 'in_review', reviewNote: 'Falta a ementa.' }])
        const r = await service.setStatus(ator(), 'c1', 'in_review')
        expect(r).toEqual({ status: 'in_review', log: null })
        expect(db.select).toHaveBeenCalledTimes(1) // só a posse: nada de consulta às aulas
        expect(db.update).not.toHaveBeenCalled()
      })

      it('vale também para publicado e para rascunho, com ou sem nota', async () => {
        for (const linha of [
          { ...courseRow, status: 'published', reviewNote: 'Aula 3 sem áudio.' },
          { ...courseRow, status: 'published', approvedAt: new Date() },
          { ...courseRow, status: 'draft', reviewNote: 'Aula 3 sem áudio.' },
        ]) {
          const { db, service } = make()
          withQueryResults(db, [linha])
          expect(await service.setStatus(ator(), 'c1', linha.status as 'published' | 'draft')).toEqual({ status: linha.status, log: null })
          expect(db.update).not.toHaveBeenCalled()
        }
      })

      it('a posse continua valendo: curso de outro polo é 404 e curso alheio é 403, mesmo repetindo o status', async () => {
        const a = make()
        withQueryResults(a.db, [])
        await expect(a.service.setStatus(ator(), 'c-de-outro', 'draft')).rejects.toThrow(NotFoundException)
        const b = make()
        withQueryResults(b.db, [{ ...courseRow, instructorId: 'outro' }])
        await expect(b.service.setStatus(ator(), 'c1', 'draft')).rejects.toBeInstanceOf(ForbiddenException)
        expect(b.db.update).not.toHaveBeenCalled()
      })
    })

    describe('primeira aprovação congela a carga horária calculada pela soma das aulas', () => {
      // O certificado imprime a carga do curso e, sem ela, a soma das aulas; as aulas seguem editáveis depois da
      // aprovação. Gravar a soma na aprovação põe o número impresso sob a trava dos dados do certificado.
      const plataforma = () => admin({ uid: 'u-plat', isPlatformAdmin: true })

      it('sem carga declarada: grava a soma arredondada, na mesma gravação da aprovação', async () => {
        const { db, service } = make()
        withQueryResults(db, [{ ...courseRow, status: 'in_review', workloadHours: null }], [{ id: 'l1' }], [{ dur: '12960' }], undefined)
        await service.setStatus(plataforma(), 'c1', 'published')
        expect(db.update).toHaveBeenCalledTimes(1)
        expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ approvedAt: expect.any(Date), approvedBy: 'u-plat', workloadHours: 4 }))
      })

      it('a soma é a das aulas DESTE curso', async () => {
        const { db, service } = make()
        withQueryResults(db, [{ ...courseRow, status: 'in_review', workloadHours: null }], [{ id: 'l1' }], [{ dur: '7200' }], undefined)
        await service.setStatus(plataforma(), 'c1', 'published')
        // [0] posse, [1] há aula?, [2] a soma, [3] o UPDATE
        expect(allWheres(db.where)[2]).toEqual({ sql: '`modules`.`course_id` = ?', params: ['c1'] })
      })

      it('com carga declarada, ela vale e nada é trocado', async () => {
        const { db, service } = make()
        withQueryResults(db, [{ ...courseRow, status: 'in_review', workloadHours: 180 }], [{ id: 'l1' }], [{ dur: '7200' }], undefined)
        await service.setStatus(plataforma(), 'c1', 'published')
        const set = db.set.mock.calls[0][0]
        expect(set).toMatchObject({ approvedAt: expect.any(Date) })
        expect(set).not.toHaveProperty('workloadHours')
      })

      it('carga 0 conta como não declarada, como no certificado', async () => {
        const { db, service } = make()
        withQueryResults(db, [{ ...courseRow, status: 'in_review', workloadHours: 0 }], [{ id: 'l1' }], [{ dur: '7200' }], undefined)
        await service.setStatus(plataforma(), 'c1', 'published')
        expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ workloadHours: 2 }))
      })

      it('aulas sem duração cadastrada: nunca congela 0 hora, o mínimo é 1', async () => {
        const a = make()
        withQueryResults(a.db, [{ ...courseRow, status: 'in_review', workloadHours: null }], [{ id: 'l1' }], [{ dur: null }], undefined)
        await a.service.setStatus(plataforma(), 'c1', 'published')
        expect(a.db.set).toHaveBeenCalledWith(expect.objectContaining({ workloadHours: 1 }))
        const b = make()
        withQueryResults(b.db, [{ ...courseRow, status: 'in_review', workloadHours: null }], [{ id: 'l1' }], [{ dur: '60' }], undefined)
        await b.service.setStatus(plataforma(), 'c1', 'published')
        expect(b.db.set).toHaveBeenCalledWith(expect.objectContaining({ workloadHours: 1 }))
      })

      it('o admin da matriz, que publica direto, congela do mesmo jeito', async () => {
        const { db, service } = make()
        withQueryResults(db, [{ ...courseRow, tenantId: 't-m', workloadHours: null }], [{ id: 'l1' }], [{ dur: '10800' }], undefined)
        await service.setStatus(admin({ tenantId: 't-m', isMatriz: true }), 'c1', 'published')
        expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ approvedAt: expect.any(Date), workloadHours: 3 }))
      })

      it('só na PRIMEIRA aprovação: curso já aprovado não é refeito (nem consulta a soma)', async () => {
        const { db, service } = make()
        withQueryResults(db, [{ ...courseRow, approvedAt: new Date('2026-09-01T00:00:00Z'), workloadHours: null }], [{ id: 'l1' }], undefined)
        await service.setStatus(admin({ isPlatformAdmin: true }), 'c1', 'published')
        expect(db.select).toHaveBeenCalledTimes(2) // posse e "há aula?", sem a soma
        expect(db.set.mock.calls[0][0]).not.toHaveProperty('workloadHours')
      })

      it('envio para análise e republicação do polo não congelam nada', async () => {
        const a = make()
        withQueryResults(a.db, [{ ...courseRow, workloadHours: null }], [{ id: 'l1' }], undefined)
        await a.service.setStatus(ator(), 'c1', 'in_review')
        expect(a.db.set.mock.calls[0][0]).not.toHaveProperty('workloadHours')
        expect(a.db.select).toHaveBeenCalledTimes(2)
        const b = make()
        withQueryResults(b.db, [{ ...courseRow, approvedAt: new Date(), workloadHours: null }], [{ id: 'l1' }], undefined)
        await b.service.setStatus(admin(), 'c1', 'published')
        expect(b.db.set.mock.calls[0][0]).not.toHaveProperty('workloadHours')
      })

      it('a aprovação recusada não consulta a soma nem grava', async () => {
        const { db, service } = make()
        withQueryResults(db, [{ ...courseRow, status: 'in_review', workloadHours: null }])
        await expect(service.setStatus(admin(), 'c1', 'published')).rejects.toBeInstanceOf(ForbiddenException)
        expect(db.select).toHaveBeenCalledTimes(1)
        expect(db.update).not.toHaveBeenCalled()
      })
    })
  })

  describe('updateMeta (A04: preço de curso publicado)', () => {
    const publishedRow = { ...courseRow, status: 'published', priceInCents: 10000, promoPriceInCents: null, promoEndsAt: null }

    it('instrutor muda o preço de curso publicado → 403 e nada é gravado', async () => {
      const { db, service } = make()
      withQueryResults(db, [publishedRow])
      await expect(service.updateMeta(ator(), 'c1', { priceInCents: 5000 })).rejects.toBeInstanceOf(ForbiddenException)
      expect(db.update).not.toHaveBeenCalled()
    })

    it('salvar o form com o MESMO preço em curso publicado → ok (form manda o objeto inteiro)', async () => {
      const { db, service } = make()
      withQueryResults(db, [publishedRow], undefined, [{ ...publishedRow, title: 'Novo' }])
      const { course: r } = await service.updateMeta(ator(), 'c1', { title: 'Novo', priceInCents: 10000, promoPriceInCents: null, promoEndsAt: null })
      expect(r.title).toBe('Novo')
    })

    it('instrutor muda o preço em rascunho → ok (revisão acontece na publicação)', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ ...courseRow, priceInCents: 10000 }], undefined, [{ ...courseRow, priceInCents: 5000 }])
      const { course: r } = await service.updateMeta(ator(), 'c1', { priceInCents: 5000 })
      expect(r.priceInCents).toBe(5000)
    })

    it('admin muda o preço de curso publicado → ok', async () => {
      const { db, service } = make()
      withQueryResults(db, [publishedRow], undefined, [{ ...publishedRow, priceInCents: 5000 }])
      const { course: r } = await service.updateMeta(admin(), 'c1', { priceInCents: 5000 })
      expect(r.priceInCents).toBe(5000)
    })
  })

  describe('updateMeta por polo', () => {
    it('o UPDATE final filtra pelo polo, além do id', async () => {
      const { db, service } = make()
      withQueryResults(db, [courseRow], undefined, [courseRow])
      await service.updateMeta(ator(), 'c1', { title: 'Novo' })
      // [0] = posse (scope.byId), [1] = o UPDATE, [2] = a leitura de volta
      expect(allWheres(db.where)[1]).toEqual({ sql: '(`courses`.`id` = ? and `courses`.`tenant_id` = ?)', params: ['c1', 't-a'] })
    })

    it('categoria de outro polo → 400 e nada é gravado', async () => {
      const { db, service } = make()
      withQueryResults(db, [courseRow], [])
      await expect(service.updateMeta(ator(), 'c1', { categoryId: 'cat-de-outro' })).rejects.toThrow(BadRequestException)
      expect(allWheres(db.where)[1]).toEqual({ sql: '(`categories`.`id` = ? and `categories`.`tenant_id` = ?)', params: ['cat-de-outro', 't-a'] })
      expect(db.update).not.toHaveBeenCalled()
    })

    it('categoria do próprio polo → grava', async () => {
      const { db, service } = make()
      withQueryResults(db, [courseRow], [{ id: 'cat-a' }], undefined, [{ ...courseRow, categoryId: 'cat-a' }])
      const { course: r } = await service.updateMeta(ator(), 'c1', { categoryId: 'cat-a' })
      expect(r.categoryId).toBe('cat-a')
    })

    it('limpar a categoria (null) é permitido e não consulta categorias', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ ...courseRow, categoryId: 'cat-a' }], undefined, [courseRow])
      await service.updateMeta(ator(), 'c1', { categoryId: null })
      expect(db.update).toHaveBeenCalled()
      expect(allWheres(db.where).some((w) => w.sql.includes('categories'))).toBe(false)
    })

    it('curso de outro polo → 404, mesmo para admin, e nada é gravado', async () => {
      const { db, service } = make()
      withQueryResults(db, [])
      await expect(service.updateMeta(admin(), 'c-de-outro', { title: 'invasão' })).rejects.toThrow(NotFoundException)
      expect(db.update).not.toHaveBeenCalled()
    })
  })

  describe('updateMeta: tutor de voz (cada pergunta custa para o Studio Pilari)', () => {
    it('admin do polo não liga o tutor: o campo é descartado e o resto do formulário salva', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ ...courseRow, status: 'draft' }], undefined, [{ ...courseRow, description: 'Texto novo' }])
      await service.updateMeta(admin(), 'c1', { description: 'Texto novo', tutorEnabled: true })
      const set = db.set.mock.calls[0][0]
      expect(set).toMatchObject({ description: 'Texto novo' })
      expect(set).not.toHaveProperty('tutorEnabled')
    })

    it('o admin da plataforma liga o tutor', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ ...courseRow, status: 'draft' }], undefined, [{ ...courseRow, tutorEnabled: true }])
      await service.updateMeta(admin({ isPlatformAdmin: true }), 'c1', { tutorEnabled: true })
      expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ tutorEnabled: true }))
    })
  })

  describe('updateMeta: trava dos dados do certificado depois da aprovação', () => {
    const aprovadoEm = new Date('2026-09-01T00:00:00Z')
    const aprovado = {
      ...courseRow, status: 'published', approvedAt: aprovadoEm, workloadHours: 40, title: 'Excel', priceInCents: 0,
      coordinatorName: 'Ana', coordinatorRole: 'Coord.', coordinatorSignaturePath: 'cursos/c1/signature/a.png',
    }

    it('mudar carga horária de curso aprovado responde CERTIFICATE_FIELDS_LOCKED', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ id: 'c1', tenantId: 't-a', instructorId: 'prof', status: 'published', approvedAt: new Date(), workloadHours: 40, title: 'Excel', priceInCents: 0 }])
      await expect(service.updateMeta(ator({ isAdmin: true }), 'c1', { workloadHours: 360 })).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'CERTIFICATE_FIELDS_LOCKED' }),
      })
    })

    it('a resposta é 403 em português, nomeia o campo e lista o que travou; nada é gravado', async () => {
      const { db, service } = make()
      withQueryResults(db, [aprovado])
      const erro = await service.updateMeta(admin(), 'c1', { title: 'Excel Avançado', workloadHours: 360 }).then(() => null, (e: unknown) => e)
      expect(erro).toBeInstanceOf(ForbiddenException)
      expect((erro as ForbiddenException).getResponse()).toEqual({
        statusCode: 403,
        code: 'CERTIFICATE_FIELDS_LOCKED',
        message: 'Depois da aprovação, o título e a carga horária só mudam pelo Studio Pilari. Peça a alteração ao Studio Pilari.',
        fields: ['title', 'workloadHours'],
      })
      expect(db.update).not.toHaveBeenCalled()
    })

    it('um campo só: o verbo concorda no singular ("a carga horária só muda")', async () => {
      const { db, service } = make()
      withQueryResults(db, [aprovado])
      const erro = await service.updateMeta(admin(), 'c1', { workloadHours: 360 }).then(() => null, (e: unknown) => e)
      expect((erro as ForbiddenException).getResponse()).toMatchObject({
        message: 'Depois da aprovação, a carga horária só muda pelo Studio Pilari. Peça a alteração ao Studio Pilari.',
        fields: ['workloadHours'],
      })
    })

    it('o formulário inteiro, sem mudar os campos travados, passa', async () => {
      const { db, service } = make()
      withQueryResults(db, [aprovado], undefined, [{ ...aprovado, description: 'Nova descrição' }])
      const { course: r } = await service.updateMeta(admin(), 'c1', {
        title: 'Excel', workloadHours: 40, coordinatorName: 'Ana', coordinatorRole: 'Coord.',
        coordinatorSignaturePath: 'cursos/c1/signature/a.png', description: 'Nova descrição', priceInCents: 0,
      })
      expect(r.description).toBe('Nova descrição')
      expect(db.update).toHaveBeenCalled()
    })

    it('limpar o coordenador de curso aprovado também é mudança travada', async () => {
      const { db, service } = make()
      withQueryResults(db, [aprovado])
      const erro = await service.updateMeta(admin(), 'c1', { coordinatorName: null, coordinatorRole: null, coordinatorSignaturePath: null }).then(() => null, (e: unknown) => e)
      expect((erro as ForbiddenException).getResponse()).toMatchObject({
        code: 'CERTIFICATE_FIELDS_LOCKED', fields: ['coordinatorName', 'coordinatorRole', 'coordinatorSignaturePath'],
        message: 'Depois da aprovação, o coordenador, o cargo do coordenador e a assinatura do coordenador só mudam pelo Studio Pilari. Peça a alteração ao Studio Pilari.',
      })
      expect(db.update).not.toHaveBeenCalled()
    })

    it('o admin da plataforma corrige o título de curso aprovado', async () => {
      const { db, service } = make()
      withQueryResults(db, [aprovado], undefined, [{ ...aprovado, title: 'Excel Essencial' }])
      const { course: r } = await service.updateMeta(admin({ isPlatformAdmin: true }), 'c1', { title: 'Excel Essencial', workloadHours: 360 })
      expect(r.title).toBe('Excel Essencial')
      expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ title: 'Excel Essencial', workloadHours: 360 }))
    })

    it('antes da aprovação nada trava, nem para o admin do polo', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ ...aprovado, status: 'draft', approvedAt: null }], undefined, [{ ...aprovado, approvedAt: null, workloadHours: 360 }])
      await service.updateMeta(admin(), 'c1', { title: 'Outro título', workloadHours: 360, coordinatorName: 'Beto' })
      expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ title: 'Outro título', workloadHours: 360, coordinatorName: 'Beto' }))
    })

    it('instrutor: o coordenador é descartado ANTES da trava, então o save dele passa; título e carga continuam travados', async () => {
      const a = make()
      withQueryResults(a.db, [aprovado], undefined, [aprovado])
      await a.service.updateMeta(ator(), 'c1', { title: 'Excel', description: 'Texto novo', coordinatorName: 'Fulano', coordinatorRole: null, coordinatorSignaturePath: null })
      const set = a.db.set.mock.calls[0][0]
      expect(set).toMatchObject({ description: 'Texto novo' })
      expect(set).not.toHaveProperty('coordinatorName')

      const b = make()
      withQueryResults(b.db, [aprovado])
      await expect(b.service.updateMeta(ator(), 'c1', { workloadHours: 360 })).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'CERTIFICATE_FIELDS_LOCKED', fields: ['workloadHours'] }),
      })
      expect(b.db.update).not.toHaveBeenCalled()
    })
  })

  describe('o curso devolvido ao instrutor informa a aprovação, a nota e a trava para quem está vendo', () => {
    const aprovadoEm = new Date('2026-09-01T12:30:00Z')
    const aprovado = { ...courseRow, status: 'published', approvedAt: aprovadoEm, reviewNote: null }

    it('getOne: admin do polo vê a trava ligada e a aprovação em ISO', async () => {
      const { db, service } = make()
      withQueryResults(db, [aprovado], [{ n: 1 }], [{ n: 3 }])
      const c = await service.getOne(admin(), 'c1')
      expect(c).toMatchObject({ approvedAt: '2026-09-01T12:30:00.000Z', reviewNote: null, certificateFieldsLocked: true })
    })

    it('getOne: para o admin da plataforma a trava vem desligada, mesmo com o curso aprovado', async () => {
      const { db, service } = make()
      withQueryResults(db, [aprovado], [{ n: 1 }], [{ n: 3 }])
      const c = await service.getOne(admin({ isPlatformAdmin: true }), 'c1')
      expect(c).toMatchObject({ approvedAt: '2026-09-01T12:30:00.000Z', certificateFieldsLocked: false })
    })

    it('getOne: curso nunca aprovado não tem trava e traz a nota do Studio Pilari', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ ...courseRow, reviewNote: 'Aula 3 sem áudio.' }], [{ n: 1 }], [{ n: 3 }])
      const c = await service.getOne(ator(), 'c1')
      expect(c).toMatchObject({ approvedAt: null, reviewNote: 'Aula 3 sem áudio.', certificateFieldsLocked: false })
    })

    it('listMine repassa quem está vendo: instrutor tem a trava, a plataforma não', async () => {
      const a = make()
      withQueryResults(a.db, [aprovado], [{ courseId: 'c1', n: 1 }], [{ courseId: 'c1', n: 3 }])
      expect((await a.service.listMine(ator()))[0]).toMatchObject({ approvedAt: '2026-09-01T12:30:00.000Z', certificateFieldsLocked: true })
      const b = make()
      withQueryResults(b.db, [aprovado], [{ courseId: 'c1', n: 1 }], [{ courseId: 'c1', n: 3 }])
      expect((await b.service.listMine(ator({ isPlatformAdmin: true })))[0]).toMatchObject({ certificateFieldsLocked: false })
    })

    it('create devolve o curso novo sem aprovação, sem nota e sem trava', async () => {
      const { db, service } = make()
      withQueryResults(db, [], undefined, [courseRow])
      expect(await service.create(ator(), { title: 'Curso' })).toMatchObject({ approvedAt: null, reviewNote: null, certificateFieldsLocked: false })
    })

    it('updateMeta devolve o curso com a trava de quem salvou', async () => {
      const a = make()
      withQueryResults(a.db, [aprovado], undefined, [aprovado])
      expect((await a.service.updateMeta(admin(), 'c1', { description: 'x' })).course).toMatchObject({ certificateFieldsLocked: true })
      const b = make()
      withQueryResults(b.db, [aprovado], undefined, [aprovado])
      expect((await b.service.updateMeta(admin({ isPlatformAdmin: true }), 'c1', { description: 'x' })).course).toMatchObject({ certificateFieldsLocked: false })
    })
  })
})

describe('capa nova só da pasta cover do próprio curso (ou link)', () => {
  const CAPA_INVALIDA = { statusCode: 400, code: 'INVALID_COVER_PATH', message: 'A capa precisa ser uma imagem enviada pelo editor deste curso ou um link http(s).' }

  it.each(['cursos/c1/video/aula.mp4', 'cursos/c1/attachment/a.pdf', 'cursos/c1/signature/r.png', 'cursos/c1/capa.png'])('%s → 400 e nada é gravado', async (caminho) => {
    const { db, service } = make()
    withQueryResults(db, [courseRow])
    const erro = await service.updateMeta(ator(), 'c1', { coverImageUrl: caminho }).then(() => null, (e: unknown) => e)
    expect(erro).toBeInstanceOf(BadRequestException)
    expect((erro as BadRequestException).getResponse()).toEqual(CAPA_INVALIDA)
    expect(db.update).not.toHaveBeenCalled()
  })

  it.each(['cursos/c1/cover/x-capa.png', 'https://img.exemplo.com/capa.png', null])('%p passa', async (valor) => {
    const { db, service } = make()
    withQueryResults(db, [courseRow], undefined, [courseRow])
    await service.updateMeta(ator(), 'c1', { coverImageUrl: valor })
    expect(db.update).toHaveBeenCalled()
  })

  it('o valor antigo, igual ao gravado, passa mesmo fora da pasta cover (o editor manda o objeto inteiro)', async () => {
    const legado = { ...courseRow, coverImageUrl: 'cursos/c1/video/capa-antiga.png' }
    const { db, service } = make()
    withQueryResults(db, [legado], undefined, [legado])
    await service.updateMeta(ator(), 'c1', { coverImageUrl: 'cursos/c1/video/capa-antiga.png', subtitle: 'x' })
    expect(db.update).toHaveBeenCalled()
  })
})

describe('rastro de mudança em curso aprovado (o service devolve o registro; o controller grava)', () => {
  const aprovado = { ...courseRow, title: 'Excel', status: 'published', approvedAt: new Date('2026-09-01T00:00:00Z'), workloadHours: 40 }
  const plataforma = () => admin({ uid: 'u-plat', isPlatformAdmin: true })

  it('updateMeta: a plataforma muda título e carga de curso aprovado → course.locked-fields com os campos, no curso', async () => {
    const { db, service } = make()
    withQueryResults(db, [aprovado], undefined, [aprovado])
    const r = await service.updateMeta(plataforma(), 'c1', { title: 'Excel Essencial', workloadHours: 60, description: 'x' })
    expect(r.log).toEqual({ courseId: 'c1', action: 'course.locked-fields', summary: 'Curso "Excel": o Studio Pilari alterou o título e a carga horária' })
  })

  it('updateMeta: sem campo travado mudando, ou com o curso nunca aprovado, não há registro', async () => {
    for (const [curso, patch] of [
      [aprovado, { title: 'Excel', workloadHours: 40, description: 'x' }],
      [{ ...aprovado, approvedAt: null }, { title: 'Outro', workloadHours: 60 }],
    ] as const) {
      const { db, service } = make()
      withQueryResults(db, [curso], undefined, [curso])
      expect((await service.updateMeta(plataforma(), 'c1', { ...patch })).log).toBeNull()
    }
  })

  it('removeModule, removeLesson e updateLesson (duração) em curso aprovado devolvem o registro com os nomes', async () => {
    const mod = make()
    withQueryResults(mod.db, [{ courseId: 'c1' }], [aprovado], [{ title: 'Módulo 2' }], undefined)
    expect(await mod.service.removeModule(ator(), 'm2')).toEqual({ courseId: 'c1', action: 'course.module-delete', summary: 'Curso "Excel": excluiu o módulo "Módulo 2"' })

    const aula = make()
    withQueryResults(aula.db, [{ courseId: 'c1' }], [aprovado], [{ title: 'Aula 2' }], undefined)
    expect(await aula.service.removeLesson(ator(), 'l2')).toEqual({ courseId: 'c1', action: 'course.lesson-delete', summary: 'Curso "Excel": excluiu a aula "Aula 2"' })

    const duracao = make()
    withQueryResults(duracao.db, [{ courseId: 'c1' }], [aprovado], [{ title: 'Aula 1', durationSec: 600 }], undefined)
    expect(await duracao.service.updateLesson(ator(), 'l1', { durationSec: 3725 })).toEqual({
      courseId: 'c1', action: 'course.lesson-duration', summary: 'Curso "Excel": duração da aula "Aula 1" de 10 min → 1 h 2 min 5 s',
    })
  })

  it('updateLesson: a mesma duração, ou nenhuma duração no patch, não registra (nem consulta a aula sem duração)', async () => {
    const igual = make()
    withQueryResults(igual.db, [{ courseId: 'c1' }], [aprovado], [{ title: 'Aula 1', durationSec: 600 }], undefined)
    expect(await igual.service.updateLesson(ator(), 'l1', { durationSec: 600 })).toBeNull()
    const semDuracao = make()
    withQueryResults(semDuracao.db, [{ courseId: 'c1' }], [aprovado], undefined)
    expect(await semDuracao.service.updateLesson(ator(), 'l1', { title: 'Aula 1 revista' })).toBeNull()
    expect(semDuracao.db.select).toHaveBeenCalledTimes(2)
  })

  it('curso nunca aprovado: nada é registrado e o nome do módulo ou da aula nem é consultado', async () => {
    const rascunho = { ...aprovado, approvedAt: null }
    const mod = make()
    withQueryResults(mod.db, [{ courseId: 'c1' }], [rascunho], undefined)
    expect(await mod.service.removeModule(ator(), 'm2')).toBeNull()
    expect(mod.db.select).toHaveBeenCalledTimes(2)
    const aula = make()
    withQueryResults(aula.db, [{ courseId: 'c1' }], [rascunho], undefined)
    expect(await aula.service.removeLesson(ator(), 'l2')).toBeNull()
    const duracao = make()
    withQueryResults(duracao.db, [{ courseId: 'c1' }], [rascunho], undefined)
    expect(await duracao.service.updateLesson(ator(), 'l1', { durationSec: 900 })).toBeNull()
    expect(duracao.db.select).toHaveBeenCalledTimes(2)
  })
})

describe('coordenador do curso (2ª assinatura do certificado)', () => {
  // O nome vai impresso num documento oficial. Se um instrutor puder gravá-lo,
  // ele nomeia o próprio "coordenador" no certificado que a instituição assina.
  it('instrutor NÃO grava o coordenador, mas o resto do save passa', async () => {
    const { db, service } = make()
    withQueryResults(db, [courseRow], undefined, [courseRow])
    await service.updateMeta(ator(), 'c1', { title: 'Novo', coordinatorName: 'Fulano', coordinatorRole: 'Reitor' })
    const set = db.update.mock.results[0].value.set.mock.calls[0][0]
    expect(set).not.toHaveProperty('coordinatorName')
    expect(set).not.toHaveProperty('coordinatorRole')
    expect(set.title).toBe('Novo')
  })

  it('admin grava o coordenador', async () => {
    const { db, service } = make()
    withQueryResults(db, [courseRow], undefined, [courseRow])
    await service.updateMeta(admin(), 'c1', { coordinatorName: 'Jane Veck', coordinatorRole: 'Coordenadora do Curso' })
    const set = db.update.mock.results[0].value.set.mock.calls[0][0]
    expect(set.coordinatorName).toBe('Jane Veck')
    expect(set.coordinatorRole).toBe('Coordenadora do Curso')
  })
})

it('instrutor NÃO grava a rubrica do coordenador', async () => {
  // A imagem da rubrica é assinatura em documento oficial, igual ao nome: só a instituição.
  const { db, service } = make()
  withQueryResults(db, [courseRow], undefined, [courseRow])
  await service.updateMeta(ator(), 'c1', { title: 'X', coordinatorSignaturePath: 'falsa.png' })
  const set = db.update.mock.results[0].value.set.mock.calls[0][0]
  expect(set).not.toHaveProperty('coordinatorSignaturePath')
  expect(set.title).toBe('X')
})

describe('rubrica do coordenador presa ao próprio curso', () => {
  // A rubrica é lida do bucket com a service account (rota /signature e emissão do diploma). Se o admin
  // de um polo pudesse gravar o caminho de OUTRO curso, baixaria o arquivo de outro polo e ainda o
  // veria impresso no diploma. Quem grava passa pelo mesmo helper da capa.
  const ALHEIA = 'cursos/c-do-outro-polo/signature/rubrica.png'
  const PROPRIA = 'cursos/c1/signature/rubrica.png'

  it('admin grava caminho de OUTRO curso → 403 com o mesmo erro da capa, e nada é gravado', async () => {
    const a = make()
    withQueryResults(a.db, [courseRow])
    const daRubrica = await a.service.updateMeta(admin(), 'c1', { coordinatorName: 'Ana', coordinatorSignaturePath: ALHEIA }).then(() => null, (e: unknown) => e)
    const b = make()
    withQueryResults(b.db, [courseRow])
    const daCapa = await b.service.updateMeta(admin(), 'c1', { coverImageUrl: 'cursos/c-do-outro-polo/cover/capa.png' }).then(() => null, (e: unknown) => e)
    expect(daRubrica).toBeInstanceOf(ForbiddenException)
    expect((daRubrica as ForbiddenException).getResponse()).toEqual((daCapa as ForbiddenException).getResponse())
    expect((daRubrica as ForbiddenException).message).toBe('Caminho de arquivo inválido para este curso.')
    expect(a.db.update).not.toHaveBeenCalled()
  })

  it('caminho fora de cursos/<id>/ também é barrado (prefixo parecido, sem a barra, e fora de cursos/)', async () => {
    for (const ruim of ['cursos/c1x/signature/a.png', 'cursos/c1', 'assinaturas/diretora.png', 'falsa.png']) {
      const { db, service } = make()
      withQueryResults(db, [courseRow])
      await expect(service.updateMeta(admin(), 'c1', { coordinatorSignaturePath: ruim })).rejects.toBeInstanceOf(ForbiddenException)
      expect(db.update).not.toHaveBeenCalled()
    }
  })

  it('caminho dentro de cursos/<id>/ é gravado', async () => {
    const { db, service } = make()
    withQueryResults(db, [courseRow], undefined, [{ ...courseRow, coordinatorName: 'Ana', coordinatorSignaturePath: PROPRIA }])
    const { course: r } = await service.updateMeta(admin(), 'c1', { coordinatorName: 'Ana', coordinatorSignaturePath: PROPRIA })
    expect(r.coordinatorSignaturePath).toBe(PROPRIA)
    expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ coordinatorSignaturePath: PROPRIA }))
  })

  it('valor IGUAL ao atual passa (o editor manda o objeto inteiro), até um legado de outro curso', async () => {
    const { db, service } = make()
    withQueryResults(db, [{ ...courseRow, coordinatorSignaturePath: ALHEIA }], undefined, [{ ...courseRow, coordinatorSignaturePath: ALHEIA, subtitle: 'Novo' }])
    await service.updateMeta(admin(), 'c1', { subtitle: 'Novo', coordinatorSignaturePath: ALHEIA })
    expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ subtitle: 'Novo', coordinatorSignaturePath: ALHEIA }))
  })

  it('trocar o legado de outro curso por OUTRO caminho de outro curso é barrado: só o valor igual passa', async () => {
    const { db, service } = make()
    withQueryResults(db, [{ ...courseRow, coordinatorSignaturePath: ALHEIA }])
    await expect(service.updateMeta(admin(), 'c1', { coordinatorSignaturePath: 'cursos/c-de-outro-ainda/signature/x.png' })).rejects.toBeInstanceOf(ForbiddenException)
    expect(db.update).not.toHaveBeenCalled()
  })

  it('null remove a rubrica, mesmo com um legado de outro curso gravado', async () => {
    const { db, service } = make()
    withQueryResults(db, [{ ...courseRow, coordinatorSignaturePath: ALHEIA }], undefined, [courseRow])
    await service.updateMeta(admin(), 'c1', { coordinatorSignaturePath: null })
    expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ coordinatorSignaturePath: null }))
  })

  it('curso aprovado: para o admin do polo a trava do certificado vem primeiro; a plataforma passa pela trava e cai na checagem do caminho', async () => {
    const aprovado = { ...courseRow, status: 'published', approvedAt: new Date('2026-09-01T00:00:00Z'), coordinatorSignaturePath: PROPRIA }
    const a = make()
    withQueryResults(a.db, [aprovado])
    await expect(a.service.updateMeta(admin(), 'c1', { coordinatorSignaturePath: ALHEIA })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CERTIFICATE_FIELDS_LOCKED' }),
    })
    const b = make()
    withQueryResults(b.db, [aprovado])
    await expect(b.service.updateMeta(admin({ isPlatformAdmin: true }), 'c1', { coordinatorSignaturePath: ALHEIA })).rejects.toThrow('Caminho de arquivo inválido para este curso.')
    expect(b.db.update).not.toHaveBeenCalled()
  })
})

describe('módulos, aulas e anexos resolvem o curso pelo polo do ator', () => {
  // Módulo, aula e anexo não têm polo próprio: o polo é o do curso. Todo método parte do id e
  // pergunta ao escopo "este módulo/aula é de um curso DESTE polo?" — fora dele, 404.
  const alheios: Array<[string, (s: AuthoringService, a: Actor) => Promise<unknown>]> = [
    ['createModule', (s, a) => s.createModule(a, 'c-de-outro', 'Módulo')],
    ['reorderModules', (s, a) => s.reorderModules(a, 'c-de-outro', ['m1'])],
    ['updateModule', (s, a) => s.updateModule(a, 'm-de-outro', 'Novo')],
    ['setModuleRelease', (s, a) => s.setModuleRelease(a, 'm-de-outro', null)],
    ['removeModule', (s, a) => s.removeModule(a, 'm-de-outro')],
    ['createLesson', (s, a) => s.createLesson(a, 'm-de-outro', 'Aula')],
    ['reorderLessons', (s, a) => s.reorderLessons(a, 'm-de-outro', ['l1'])],
    ['updateLesson', (s, a) => s.updateLesson(a, 'l-de-outro', { title: 'x' })],
    ['removeLesson', (s, a) => s.removeLesson(a, 'l-de-outro')],
    ['addAttachment', (s, a) => s.addAttachment(a, 'l-de-outro', 'a.pdf', 'https://exemplo.com/a.pdf')],
  ]

  it.each(alheios)('%s com id de outro polo → 404 (mesmo para admin) e nada é gravado', async (_nome, chamar) => {
    const { db, service } = make()
    withQueryResults(db, [])
    await expect(chamar(service, admin())).rejects.toThrow(NotFoundException)
    // a primeira consulta já carrega o polo do ator: é ela que esconde o registro do outro polo
    expect(allWheres(db.where)[0].params).toContain('t-a')
    expect(db.insert).not.toHaveBeenCalled()
    expect(db.update).not.toHaveBeenCalled()
    expect(db.delete).not.toHaveBeenCalled()
  })

  it('removeAttachment: anexo inexistente → 404', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    await expect(service.removeAttachment(admin(), 'an-inexistente')).rejects.toThrow('Anexo não encontrado.')
    expect(db.delete).not.toHaveBeenCalled()
  })

  it('removeAttachment: anexo cuja aula é de outro polo → 404 e nada é apagado', async () => {
    const { db, service } = make()
    withQueryResults(db, [{ lessonId: 'l-de-outro' }], [])
    await expect(service.removeAttachment(admin(), 'an1')).rejects.toThrow('Aula não encontrada.')
    expect(allWheres(db.where)[1].params).toEqual(['l-de-outro', 't-a'])
    expect(db.delete).not.toHaveBeenCalled()
  })

  it('updateModule procura o módulo no polo do ator e só então checa a posse', async () => {
    const { db, service } = make()
    withQueryResults(db, [{ courseId: 'c1' }], [courseRow], undefined)
    await service.updateModule(ator(), 'm1', 'Novo título')
    const [doModulo, doCurso] = allWheres(db.where)
    expect(doModulo.params).toEqual(['m1', 't-a'])
    expect(doCurso.params).toEqual(['t-a', 'c1'])
    expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ title: 'Novo título' }))
  })

  it('módulo de curso alheio do MESMO polo → 403 para o instrutor, ok para o admin do polo', async () => {
    const alheio = { ...courseRow, instructorId: 'outro' }
    const a = make()
    withQueryResults(a.db, [{ courseId: 'c1' }], [alheio])
    await expect(a.service.removeModule(ator(), 'm1')).rejects.toBeInstanceOf(ForbiddenException)
    expect(a.db.delete).not.toHaveBeenCalled()

    const b = make()
    withQueryResults(b.db, [{ courseId: 'c1' }], [alheio], undefined)
    await b.service.removeModule(admin(), 'm1')
    expect(b.db.delete).toHaveBeenCalledTimes(1)
  })

  it('updateLesson recusa videoUrl que aponta para o prefixo de outro curso', async () => {
    const { db, service } = make()
    withQueryResults(db, [{ courseId: 'c1' }], [courseRow])
    await expect(service.updateLesson(ator(), 'l1', { videoUrl: 'cursos/c-de-outro/video/x.mp4' })).rejects.toBeInstanceOf(ForbiddenException)
    expect(db.update).not.toHaveBeenCalled()
  })

  it('addAttachment grava na aula depois de resolver o curso pelo polo', async () => {
    const { db, service } = make()
    withQueryResults(db, [{ courseId: 'c1' }], [courseRow], undefined)
    const r = await service.addAttachment(ator(), 'l1', 'apostila.pdf', 'cursos/c1/attachment/apostila.pdf')
    expect(r.id).toEqual(expect.any(String))
    expect(allWheres(db.where)[0].params).toEqual(['l1', 't-a'])
    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ lessonId: 'l1', fileName: 'apostila.pdf' }))
  })
})
