/// <reference types="jest" />
import { BadRequestException } from '@nestjs/common'
import { createDrizzleMock, withQueryResults } from '../../__test-utils__/drizzle-mock'
import { allWheres } from '../../__test-utils__/sql'
import { affectedRows, assertCourseHasLesson, statusChangedMeanwhile } from './course-transition'

describe('assertCourseHasLesson', () => {
  it('passa com ao menos uma aula do curso', async () => {
    const db = createDrizzleMock()
    withQueryResults(db, [{ id: 'l1' }])
    await expect(assertCourseHasLesson(db as never, 'c1')).resolves.toBeUndefined()
    expect(allWheres(db.where)).toEqual([{ sql: '`modules`.`course_id` = ?', params: ['c1'] }])
  })

  it('sem aula: 400 COURSE_WITHOUT_LESSONS em português', async () => {
    const db = createDrizzleMock()
    withQueryResults(db, [])
    const erro = await assertCourseHasLesson(db as never, 'c1').then(() => null, (e: unknown) => e)
    expect(erro).toBeInstanceOf(BadRequestException)
    expect((erro as BadRequestException).getResponse()).toEqual({
      statusCode: 400, code: 'COURSE_WITHOUT_LESSONS', message: 'Adicione ao menos uma aula antes de enviar para análise ou publicar.',
    })
  })
})

describe('affectedRows', () => {
  it('lê o affectedRows do cabeçalho do mysql2', () => {
    expect(affectedRows([{ affectedRows: 1, insertId: 0 }, undefined])).toBe(1)
    expect(affectedRows([{ affectedRows: 0 }])).toBe(0)
  })

  it('sem a informação devolve null (não é "nada mudou")', () => {
    for (const r of [undefined, null, [], [undefined], [{}], { affectedRows: 1 }, [{ affectedRows: '1' }]]) expect(affectedRows(r)).toBeNull()
  })
})

describe('statusChangedMeanwhile', () => {
  it('é o 400 INVALID_TRANSITION que pede para recarregar', () => {
    expect(statusChangedMeanwhile().getResponse()).toEqual({
      statusCode: 400, code: 'INVALID_TRANSITION', message: 'O curso mudou de situação enquanto você decidia. Recarregue a página.',
    })
  })
})
