/// <reference types="jest" />
import { createDrizzleMock, withQueryResults } from '../../__test-utils__/drizzle-mock'
import { allWheres, renderSql } from '../../__test-utils__/sql'
import { lessonsDurationSec, lessonsDurationSecByCourse } from './lessons-duration'

describe('lessonsDurationSec', () => {
  it('soma a duração das aulas do curso (o SUM do MySQL volta como texto)', async () => {
    const db = createDrizzleMock()
    withQueryResults(db, [{ dur: '12960' }])
    expect(await lessonsDurationSec(db as never, 'c1')).toBe(12960)
  })

  it('curso sem aula (SUM nulo) ou consulta sem linha vale 0', async () => {
    const a = createDrizzleMock()
    withQueryResults(a, [{ dur: null }])
    expect(await lessonsDurationSec(a as never, 'c1')).toBe(0)
    const b = createDrizzleMock()
    withQueryResults(b, [])
    expect(await lessonsDurationSec(b as never, 'c1')).toBe(0)
  })

  it('soma lessons.duration_sec das aulas dos módulos do curso pedido, e só dele', async () => {
    const db = createDrizzleMock()
    withQueryResults(db, [{ dur: '60' }])
    await lessonsDurationSec(db as never, 'c1')
    expect(renderSql(db.select.mock.calls[0][0].dur).sql).toBe('sum(`lessons`.`duration_sec`)')
    expect(db.innerJoin).toHaveBeenCalledTimes(1)
    expect(allWheres(db.where)).toEqual([{ sql: '`modules`.`course_id` = ?', params: ['c1'] }])
  })
})

describe('lessonsDurationSecByCourse', () => {
  it('devolve a soma de cada curso numa consulta só, agrupada por curso', async () => {
    const db = createDrizzleMock()
    withQueryResults(db, [{ courseId: 'c1', dur: '12960' }, { courseId: 'c2', dur: '600' }])
    const mapa = await lessonsDurationSecByCourse(db as never, ['c1', 'c2', 'c3'])
    expect(mapa.get('c1')).toBe(12960)
    expect(mapa.get('c2')).toBe(600)
    // Curso sem aula não volta do GROUP BY: quem consulta usa `?? 0`, como o SUM nulo da consulta de um curso.
    expect(mapa.get('c3')).toBeUndefined()
    expect(db.select).toHaveBeenCalledTimes(1)
    expect(db.groupBy).toHaveBeenCalledTimes(1)
    expect(allWheres(db.where)).toEqual([{ sql: '`modules`.`course_id` in (?, ?, ?)', params: ['c1', 'c2', 'c3'] }])
  })

  it('soma lessons.duration_sec, a mesma coluna da consulta de um curso', async () => {
    const db = createDrizzleMock()
    withQueryResults(db, [])
    await lessonsDurationSecByCourse(db as never, ['c1'])
    expect(renderSql(db.select.mock.calls[0][0].dur).sql).toBe('sum(`lessons`.`duration_sec`)')
    expect(db.innerJoin).toHaveBeenCalledTimes(1)
  })

  it('SUM nulo vira 0', async () => {
    const db = createDrizzleMock()
    withQueryResults(db, [{ courseId: 'c1', dur: null }])
    expect((await lessonsDurationSecByCourse(db as never, ['c1'])).get('c1')).toBe(0)
  })

  it('sem cursos não consulta o banco', async () => {
    const db = createDrizzleMock()
    expect((await lessonsDurationSecByCourse(db as never, [])).size).toBe(0)
    expect(db.select).not.toHaveBeenCalled()
  })
})
