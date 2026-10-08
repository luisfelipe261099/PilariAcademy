/// <reference types="jest" />
import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { createDrizzleMock, withQueryResults, type DrizzleMock } from '../../__test-utils__/drizzle-mock'
import type { Actor } from '../../common/types/actor.type'
import { CourseScopeService } from '../tenancy/course-scope.service'
import { QuizService } from './quiz.service'

function make() {
  const db: DrizzleMock = createDrizzleMock()
  const scope = new CourseScopeService(db as never)
  return { db, scope, service: new QuizService(db as never, scope) }
}

const actor = (uid: string, isAdmin = false): Actor => ({ uid, tenantId: 't-a', isMatriz: false, isAdmin, isPlatformAdmin: false })

const course = { id: 'c1', slug: 'curso', tenantId: 't-a', instructorId: 'i1' }
const POLO_A = { id: 't-a', isMatriz: false }
/**
 * Resultado de `scope.courseIdOfModule` (módulo cruzado com o polo). Tipado `unknown` porque
 * `withQueryResults` infere um único tipo para a fila toda, e uma fila mistura formas diferentes.
 */
const modulo: unknown = [{ courseId: 'c1' }]

describe('QuizService', () => {
  // ── scoring com peso ──────────────────────────────────────────────────────
  it('submit pontua por peso, não por contagem', async () => {
    const { db, service } = make()
    withQueryResults(
      db,
      modulo, // courseIdOfModule
      [{ id: 'e', status: 'active', quizAttemptRounds: 1 }], // matrícula ativa
      [], // tentativas anteriores (nenhuma)
      [
        { id: 'q1', correctIndex: 0, options: ['a', 'b'], points: '2.00' },
        { id: 'q2', correctIndex: 1, options: ['a', 'b'], points: '8.00' },
      ], // questões: total 10 pts
      undefined // insert
    )
    // acerta só a q2 (8 pts de 10) → 80, não 50 como seria por contagem
    const r = await service.submit(POLO_A, 'u1', 'm1', { q1: 1, q2: 1 })
    expect(r.score).toBe(80)
    expect(r.passed).toBe(true)
    expect(r.attemptsUsed).toBe(1)
    expect(r.maxAttempts).toBe(5)
  })

  it('submit devolve a melhor nota (não a atual)', async () => {
    const { db, service } = make()
    withQueryResults(
      db,
      modulo,
      [{ id: 'e', status: 'active', quizAttemptRounds: 1 }],
      [{ score: 90, passed: true }], // já tirou 90 antes
      [
        { id: 'q1', correctIndex: 0, options: ['a', 'b'], points: '5.00' },
        { id: 'q2', correctIndex: 0, options: ['a', 'b'], points: '5.00' },
      ],
      undefined
    )
    // acerta só a q1 → nota atual 50, mas melhor continua 90
    const r = await service.submit(POLO_A, 'u1', 'm1', { q1: 0, q2: 1 })
    expect(r.score).toBe(50)
    expect(r.bestScore).toBe(90)
    expect(r.attemptsUsed).toBe(2)
  })

  // ── limite de tentativas ──────────────────────────────────────────────────
  it('submit bloqueia após esgotar as 5 tentativas', async () => {
    const { db, service } = make()
    withQueryResults(
      db,
      modulo,
      [{ id: 'e', status: 'active', quizAttemptRounds: 1 }],
      [{ score: 10 }, { score: 20 }, { score: 30 }, { score: 40 }, { score: 50 }] // 5 tentativas
    )
    await expect(service.submit(POLO_A, 'u1', 'm1', {})).rejects.toThrow('esgotad')
  })

  it('tentativas esgotadas: nos polos manda falar com o professor ou com o polo; na matriz, com a secretaria', async () => {
    const cinco = [{ score: 10 }, { score: 20 }, { score: 30 }, { score: 40 }, { score: 50 }]
    const polo = make()
    withQueryResults(polo.db, modulo, [{ id: 'e', status: 'active', quizAttemptRounds: 1 }], cinco)
    await expect(polo.service.submit(POLO_A, 'u1', 'm1', {})).rejects.toThrow(
      'Tentativas esgotadas neste módulo. Fale com o professor do curso ou com o seu polo para liberar novas tentativas.'
    )
    const matriz = make()
    withQueryResults(matriz.db, modulo, [{ id: 'e', status: 'active', quizAttemptRounds: 1 }], cinco)
    await expect(matriz.service.submit({ id: 't-m', isMatriz: true }, 'u1', 'm1', {})).rejects.toThrow(
      'Tentativas esgotadas neste módulo. Fale com o Studio Pilari para liberar novas tentativas.'
    )
    expect(polo.db.insert).not.toHaveBeenCalled()
    expect(matriz.db.insert).not.toHaveBeenCalled()
  })

  it('liberação (rodada 2) permite tentar de novo após as 5', async () => {
    const { db, service } = make()
    withQueryResults(
      db,
      modulo,
      [{ id: 'e', status: 'active', quizAttemptRounds: 2 }], // liberado → max 10
      [{ score: 10 }, { score: 20 }, { score: 30 }, { score: 40 }, { score: 50 }],
      [{ id: 'q1', correctIndex: 0, options: ['a', 'b'], points: '10.00' }],
      undefined
    )
    const r = await service.submit(POLO_A, 'u1', 'm1', { q1: 0 })
    expect(r.score).toBe(100)
    expect(r.maxAttempts).toBe(10)
    expect(r.attemptsUsed).toBe(6)
    expect(r.locked).toBe(false)
  })

  it('submit em módulo de outro polo → 404, sem matrícula consultada nem tentativa gravada', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    await expect(service.submit(POLO_A, 'u1', 'm-de-outro-polo', { q1: 0 })).rejects.toBeInstanceOf(NotFoundException)
    expect(db.select).toHaveBeenCalledTimes(1)
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('submit sem matrícula ativa no curso do módulo → 403, sem gravar', async () => {
    const { db, service } = make()
    withQueryResults(db, modulo, [])
    await expect(service.submit(POLO_A, 'u1', 'm1', { q1: 0 })).rejects.toBeInstanceOf(ForbiddenException)
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('submit resolve o módulo pelo polo do endereço', async () => {
    const { db, scope, service } = make()
    const courseIdOfModule = jest.spyOn(scope, 'courseIdOfModule')
    withQueryResults(db, modulo, [])
    await expect(service.submit(POLO_A, 'u1', 'm1', {})).rejects.toBeInstanceOf(ForbiddenException)
    expect(courseIdOfModule).toHaveBeenCalledWith('t-a', 'm1')
  })

  // ── visão do aluno ────────────────────────────────────────────────────────
  it('getForStudent traz melhor nota, tentativas usadas e trava', async () => {
    const { db, service } = make()
    withQueryResults(
      db,
      modulo,
      [{ id: 'e', status: 'active', quizAttemptRounds: 1 }],
      [{ id: 'q1', prompt: 'p', options: ['a', 'b'], points: '10.00' }],
      [{ score: 60, passed: false }, { score: 40, passed: false }] // desc por data: mais recente primeiro
    )
    const q = await service.getForStudent('t-a', 'u1', 'm1')
    expect(q.bestScore).toBe(60)
    expect(q.lastScore).toBe(60)
    expect(q.passed).toBe(false)
    expect(q.attemptsUsed).toBe(2)
    expect(q.maxAttempts).toBe(5)
    expect(q.locked).toBe(false)
    expect(q.questions[0].points).toBe(10)
  })

  it('getForStudent resolve o módulo pelo polo do endereço', async () => {
    const { db, scope, service } = make()
    const courseIdOfModule = jest.spyOn(scope, 'courseIdOfModule')
    withQueryResults(db, modulo, [{ id: 'e', status: 'active', quizAttemptRounds: 1 }], [], [])
    await service.getForStudent('t-a', 'u1', 'm1')
    expect(courseIdOfModule).toHaveBeenCalledWith('t-a', 'm1')
  })

  it('getForStudent em módulo de outro polo → 404, sem ler questões', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    await expect(service.getForStudent('t-a', 'u1', 'm-de-outro-polo')).rejects.toBeInstanceOf(NotFoundException)
    expect(db.select).toHaveBeenCalledTimes(1)
  })

  it('getForStudent sem matrícula ativa → 403', async () => {
    const { db, service } = make()
    withQueryResults(db, modulo, [])
    await expect(service.getForStudent('t-a', 'u1', 'm1')).rejects.toBeInstanceOf(ForbiddenException)
  })

  // ── boletim do curso ──────────────────────────────────────────────────────
  it('courseGrade tira média só dos módulos com prova', async () => {
    const { db, service } = make()
    withQueryResults(
      db,
      [
        { id: 'm1', title: 'M1', order: 0 },
        { id: 'm2', title: 'M2', order: 1 },
        { id: 'm3', title: 'M3', order: 2 }, // sem prova
      ],
      [{ moduleId: 'm1' }, { moduleId: 'm2' }], // módulos com questões
      [
        { moduleId: 'm1', score: 80 },
        { moduleId: 'm1', score: 90 }, // melhor de m1 = 90 → 9,0
        { moduleId: 'm2', score: 70 }, // m2 = 7,0
      ]
    )
    const g = await service.courseGrade('u1', 'c1')
    expect(g.finalGrade).toBe(8) // (9 + 7) / 2
    expect(g.approved).toBe(true)
    expect(g.modules.find((m) => m.moduleId === 'm3')?.hasQuiz).toBe(false)
  })

  it('courseGrade: reprovado se um módulo com prova fica abaixo de 7', async () => {
    const { db, service } = make()
    withQueryResults(
      db,
      [{ id: 'm1', title: 'M1', order: 0 }, { id: 'm2', title: 'M2', order: 1 }],
      [{ moduleId: 'm1' }, { moduleId: 'm2' }],
      [{ moduleId: 'm1', score: 90 }, { moduleId: 'm2', score: 50 }] // m2 = 5,0 reprova
    )
    const g = await service.courseGrade('u1', 'c1')
    expect(g.approved).toBe(false)
    expect(g.modules.find((m) => m.moduleId === 'm2')?.passed).toBe(false)
  })

  describe('courseGradeBySlug', () => {
    const boletim: unknown[] = [
      [{ id: 'm1', title: 'M1', order: 0 }], // módulos
      [{ moduleId: 'm1' }], // com prova
      [{ moduleId: 'm1', score: 80 }], // tentativas
    ]

    it('resolve o slug pelo polo do endereço e devolve o boletim do aluno matriculado', async () => {
      const { db, scope, service } = make()
      const bySlug = jest.spyOn(scope, 'bySlug')
      withQueryResults(db, [course], [{ id: 'e', status: 'active' }], ...boletim)
      const g = await service.courseGradeBySlug('t-a', 'u1', 'curso')
      expect(bySlug).toHaveBeenCalledWith('t-a', 'curso')
      expect(g.finalGrade).toBe(8)
    })

    it('slug que só existe em outro polo → 404, sem boletim', async () => {
      const { db, service } = make()
      withQueryResults(db, [])
      await expect(service.courseGradeBySlug('t-a', 'u1', 'curso')).rejects.toBeInstanceOf(NotFoundException)
      expect(db.select).toHaveBeenCalledTimes(1)
    })

    it('aluno sem matrícula ativa no curso do polo → 403', async () => {
      const { db, service } = make()
      withQueryResults(db, [course], [])
      await expect(service.courseGradeBySlug('t-a', 'u1', 'curso')).rejects.toBeInstanceOf(ForbiddenException)
    })
  })

  // ── autoria das questões ──────────────────────────────────────────────────
  describe('questões', () => {
    const questao = { prompt: 'p', options: ['a', 'b'], correctIndex: 0 }
    const row = { id: 'q1', moduleId: 'm1', prompt: 'p', options: ['a', 'b'], correctIndex: 0, order: 0, points: '2.00' }

    it('assertOwns cruza o módulo com o polo do ator e depois confere o dono do curso', async () => {
      const { db, scope, service } = make()
      const courseIdOfModule = jest.spyOn(scope, 'courseIdOfModule')
      const owned = jest.spyOn(scope, 'owned')
      withQueryResults(db, modulo, [course], [])
      const ator = actor('i1')
      await service.listQuestions(ator, 'm1')
      expect(courseIdOfModule).toHaveBeenCalledWith('t-a', 'm1')
      expect(owned).toHaveBeenCalledWith(ator, 'c1')
    })

    describe('listQuestions', () => {
      it('o dono do curso lista as questões do módulo', async () => {
        const { db, service } = make()
        withQueryResults(db, modulo, [course], [row])
        const qs = await service.listQuestions(actor('i1'), 'm1')
        expect(qs).toEqual([{ id: 'q1', prompt: 'p', options: ['a', 'b'], correctIndex: 0, order: 0, points: 2 }])
      })

      it('módulo de outro polo → 404 mesmo para o admin, sem listar', async () => {
        const { db, service } = make()
        withQueryResults(db, [])
        await expect(service.listQuestions(actor('adm', true), 'm-b')).rejects.toBeInstanceOf(NotFoundException)
        expect(db.orderBy).not.toHaveBeenCalled()
      })

      it('curso alheio no mesmo polo → 403, sem listar', async () => {
        const { db, service } = make()
        withQueryResults(db, modulo, [{ ...course, instructorId: 'outro' }])
        await expect(service.listQuestions(actor('i1'), 'm1')).rejects.toBeInstanceOf(ForbiddenException)
        expect(db.orderBy).not.toHaveBeenCalled()
      })
    })

    describe('createQuestion', () => {
      it('o dono do curso cria a questão no fim da fila do módulo', async () => {
        const { db, service } = make()
        withQueryResults(db, modulo, [course], [{ id: 'q0' }], undefined)
        const { id } = await service.createQuestion(actor('i1'), 'm1', { ...questao, points: 10 })
        expect(id).toEqual(expect.any(String))
        expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ id, moduleId: 'm1', order: 1, points: '10.00' }))
      })

      it('o admin do polo cria em módulo de curso de outro instrutor', async () => {
        const { db, service } = make()
        withQueryResults(db, modulo, [course], [], undefined)
        await service.createQuestion(actor('adm', true), 'm1', questao)
        expect(db.insert).toHaveBeenCalled()
      })

      it('módulo de outro polo → 404 mesmo para o admin, sem inserir', async () => {
        const { db, service } = make()
        withQueryResults(db, [])
        await expect(service.createQuestion(actor('adm', true), 'm-b', questao)).rejects.toBeInstanceOf(NotFoundException)
        expect(db.insert).not.toHaveBeenCalled()
      })

      it('curso alheio no mesmo polo → 403, sem inserir', async () => {
        const { db, service } = make()
        withQueryResults(db, modulo, [{ ...course, instructorId: 'outro' }])
        await expect(service.createQuestion(actor('i1'), 'm1', questao)).rejects.toBeInstanceOf(ForbiddenException)
        expect(db.insert).not.toHaveBeenCalled()
      })
    })

    describe('updateQuestion', () => {
      it('o dono do curso edita a questão', async () => {
        const { db, service } = make()
        withQueryResults(db, [row], modulo, [course], undefined)
        await service.updateQuestion(actor('i1'), 'q1', { prompt: 'novo', points: 3 })
        expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'novo', points: '3.00' }))
      })

      it('questão inexistente → 404', async () => {
        const { db, service } = make()
        withQueryResults(db, [])
        await expect(service.updateQuestion(actor('i1'), 'qX', { prompt: 'x' })).rejects.toBeInstanceOf(NotFoundException)
        expect(db.update).not.toHaveBeenCalled()
      })

      it('questão de módulo de outro polo → 404 mesmo para o admin, sem alterar', async () => {
        const { db, service } = make()
        withQueryResults(db, [row], [])
        await expect(service.updateQuestion(actor('adm', true), 'q1', { prompt: 'x' })).rejects.toBeInstanceOf(NotFoundException)
        expect(db.update).not.toHaveBeenCalled()
      })

      it('questão de curso alheio no mesmo polo → 403, sem alterar', async () => {
        const { db, service } = make()
        withQueryResults(db, [row], modulo, [{ ...course, instructorId: 'outro' }])
        await expect(service.updateQuestion(actor('i1'), 'q1', { prompt: 'x' })).rejects.toBeInstanceOf(ForbiddenException)
        expect(db.update).not.toHaveBeenCalled()
      })
    })

    describe('removeQuestion', () => {
      it('o dono do curso apaga a questão; curso nunca aprovado não gera registro para o log', async () => {
        const { db, service } = make()
        withQueryResults(db, [row], modulo, [course], undefined)
        expect(await service.removeQuestion(actor('i1'), 'q1')).toBeNull()
        expect(db.delete).toHaveBeenCalled()
      })

      it('em curso aprovado devolve o registro para o log do polo, com o curso, o módulo e o enunciado', async () => {
        const { db, service } = make()
        withQueryResults(db, [{ ...row, prompt: 'Quanto é 1 + 1?' }], modulo, [{ ...course, title: 'Excel', approvedAt: new Date() }], [{ title: 'Módulo 1' }], undefined)
        expect(await service.removeQuestion(actor('i1'), 'q1')).toEqual({
          courseId: 'c1', action: 'course.question-delete', summary: 'Curso "Excel": excluiu a questão "Quanto é 1 + 1?" da prova do módulo "Módulo 1"',
        })
        expect(db.delete).toHaveBeenCalled()
      })

      it('questão inexistente → 404', async () => {
        const { db, service } = make()
        withQueryResults(db, [])
        await expect(service.removeQuestion(actor('i1'), 'qX')).rejects.toBeInstanceOf(NotFoundException)
        expect(db.delete).not.toHaveBeenCalled()
      })

      it('questão de módulo de outro polo → 404 mesmo para o admin, sem apagar', async () => {
        const { db, service } = make()
        withQueryResults(db, [row], [])
        await expect(service.removeQuestion(actor('adm', true), 'q1')).rejects.toBeInstanceOf(NotFoundException)
        expect(db.delete).not.toHaveBeenCalled()
      })

      it('questão de curso alheio no mesmo polo → 403, sem apagar', async () => {
        const { db, service } = make()
        withQueryResults(db, [row], modulo, [{ ...course, instructorId: 'outro' }])
        await expect(service.removeQuestion(actor('i1'), 'q1')).rejects.toBeInstanceOf(ForbiddenException)
        expect(db.delete).not.toHaveBeenCalled()
      })
    })
  })

  // ── liberação de tentativas ───────────────────────────────────────────────
  it('releaseCourseQuizzes: dono do curso libera → incrementa rodadas', async () => {
    const { db, scope, service } = make()
    const owned = jest.spyOn(scope, 'owned')
    withQueryResults(db, [course], undefined)
    const ator = actor('i1')
    await expect(service.releaseCourseQuizzes(ator, 'c1', 'aluno1')).resolves.toEqual({ ok: true })
    expect(owned).toHaveBeenCalledWith(ator, 'c1')
    expect(db.update).toHaveBeenCalled()
  })

  it('releaseCourseQuizzes: o admin do polo libera em curso de outro instrutor', async () => {
    const { db, service } = make()
    withQueryResults(db, [course], undefined)
    await service.releaseCourseQuizzes(actor('adm', true), 'c1', 'aluno1')
    expect(db.update).toHaveBeenCalled()
  })

  it('releaseCourseQuizzes: quem não é dono nem admin é barrado (403), sem liberar', async () => {
    const { db, service } = make()
    withQueryResults(db, [course])
    await expect(service.releaseCourseQuizzes(actor('intruso'), 'c1', 'aluno1')).rejects.toBeInstanceOf(ForbiddenException)
    expect(db.update).not.toHaveBeenCalled()
  })

  it('releaseCourseQuizzes: curso de outro polo → 404 mesmo para o admin, sem liberar', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    await expect(service.releaseCourseQuizzes(actor('adm', true), 'c-b', 'aluno1')).rejects.toBeInstanceOf(NotFoundException)
    expect(db.update).not.toHaveBeenCalled()
  })

  // ── boletim visto pela equipe ─────────────────────────────────────────────
  describe('courseGradeForStaff', () => {
    const boletim: unknown[] = [
      [{ id: 'm1', title: 'M1', order: 0 }], // módulos
      [{ moduleId: 'm1' }], // com prova
      [{ moduleId: 'm1', score: 80 }], // tentativas
    ]

    it('dono do curso vê o boletim do aluno', async () => {
      const { db, scope, service } = make()
      const owned = jest.spyOn(scope, 'owned')
      withQueryResults(db, [course], ...boletim)
      const ator = actor('i1')
      const g = await service.courseGradeForStaff(ator, 'c1', 'aluno1')
      expect(owned).toHaveBeenCalledWith(ator, 'c1')
      expect(g.finalGrade).toBe(8)
    })

    it('o admin do polo vê o boletim de aluno em curso de outro instrutor', async () => {
      const { db, service } = make()
      withQueryResults(db, [course], ...boletim)
      const g = await service.courseGradeForStaff(actor('adm', true), 'c1', 'aluno1')
      expect(g.finalGrade).toBe(8)
    })

    it('quem não é dono nem admin é barrado (403), sem boletim', async () => {
      const { db, service } = make()
      withQueryResults(db, [course])
      await expect(service.courseGradeForStaff(actor('intruso'), 'c1', 'aluno1')).rejects.toBeInstanceOf(ForbiddenException)
      expect(db.select).toHaveBeenCalledTimes(1)
    })

    it('curso de outro polo → 404 mesmo para o admin, sem boletim', async () => {
      const { db, service } = make()
      withQueryResults(db, [])
      await expect(service.courseGradeForStaff(actor('adm', true), 'c-b', 'aluno1')).rejects.toBeInstanceOf(NotFoundException)
      expect(db.select).toHaveBeenCalledTimes(1)
    })
  })

  // ── certificado (inalterado) ──────────────────────────────────────────────
  it('allModuleQuizzesPassed: módulo com prova não aprovada → false', async () => {
    const { db, service } = make()
    withQueryResults(db, [{ moduleId: 'm1' }], [])
    expect(await service.allModuleQuizzesPassed('u1', 'c1')).toBe(false)
  })

  it('allModuleQuizzesPassed: sem provas → true', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    expect(await service.allModuleQuizzesPassed('u1', 'c1')).toBe(true)
  })
})
