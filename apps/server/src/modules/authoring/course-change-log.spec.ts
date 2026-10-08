/// <reference types="jest" />
import {
  auditCourseChange, formatDuration, lessonDeletedLog, lessonDurationLog, lockedFieldsLog, moduleDeletedLog, questionDeletedLog, statusChangedLog,
} from './course-change-log'

const curso = { id: 'c1', title: 'Excel Básico' }

describe('formatDuration', () => {
  it.each([
    [0, '0 s'], [45, '45 s'], [600, '10 min'], [3600, '1 h'], [3725, '1 h 2 min 5 s'], [5400, '1 h 30 min'], [-5, '0 s'],
  ])('%p segundos → %p', (sec, texto) => {
    expect(formatDuration(sec)).toBe(texto)
  })
})

describe('registros do log', () => {
  it('cada um leva o curso, a ação estável e o título do curso no resumo', () => {
    expect(moduleDeletedLog(curso, 'Módulo 2')).toEqual({ courseId: 'c1', action: 'course.module-delete', summary: 'Curso "Excel Básico": excluiu o módulo "Módulo 2"' })
    expect(lessonDeletedLog(curso, 'Aula 3')).toEqual({ courseId: 'c1', action: 'course.lesson-delete', summary: 'Curso "Excel Básico": excluiu a aula "Aula 3"' })
    expect(questionDeletedLog(curso, 'Módulo 1', 'Quanto é 1 + 1?')).toEqual({
      courseId: 'c1', action: 'course.question-delete', summary: 'Curso "Excel Básico": excluiu a questão "Quanto é 1 + 1?" da prova do módulo "Módulo 1"',
    })
    expect(lessonDurationLog(curso, 'Aula 1', 600, 900)).toEqual({
      courseId: 'c1', action: 'course.lesson-duration', summary: 'Curso "Excel Básico": duração da aula "Aula 1" de 10 min → 15 min',
    })
    expect(statusChangedLog(curso, 'in_review', 'published')).toEqual({ courseId: 'c1', action: 'course.status', summary: 'Curso "Excel Básico": em análise → publicado' })
    expect(statusChangedLog(curso, 'draft', 'archived').summary).toBe('Curso "Excel Básico": rascunho → arquivado')
    expect(lockedFieldsLog(curso, ['title', 'workloadHours', 'coordinatorName'])).toEqual({
      courseId: 'c1', action: 'course.locked-fields', summary: 'Curso "Excel Básico": o Studio Pilari alterou o título, a carga horária e o coordenador',
    })
  })

  it('o resumo cabe na coluna (500): nomes longos entram cortados com "…", numa linha só', () => {
    const longo = 'x'.repeat(200)
    const r = questionDeletedLog({ id: 'c1', title: longo }, longo, `Enunciado\ncom ${'y'.repeat(500)}`)
    expect(r.summary.length).toBeLessThanOrEqual(500)
    expect(r.summary).toContain(`"${'x'.repeat(119)}…"`)
    expect(r.summary).not.toContain('\n')
  })
})

describe('auditCourseChange', () => {
  it('grava o registro no polo, como quem agiu, com o curso como alvo', () => {
    const audit = { log: jest.fn() }
    auditCourseChange(audit, { uid: 'u1', email: 'u1@x.com' }, 't-a', moduleDeletedLog(curso, 'Módulo 2'))
    expect(audit.log).toHaveBeenCalledWith({
      tenantId: 't-a', actorUid: 'u1', actorEmail: 'u1@x.com', action: 'course.module-delete',
      summary: 'Curso "Excel Básico": excluiu o módulo "Módulo 2"', targetType: 'course', targetId: 'c1',
    })
  })

  it('sem registro (curso nunca aprovado), nada é gravado', () => {
    const audit = { log: jest.fn() }
    auditCourseChange(audit, { uid: 'u1' }, 't-a', null)
    expect(audit.log).not.toHaveBeenCalled()
  })
})
