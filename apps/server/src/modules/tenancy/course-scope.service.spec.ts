import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { createDrizzleMock, withQueryResults } from '../../__test-utils__/drizzle-mock'
import { allWheres } from '../../__test-utils__/sql'
import { CourseScopeService } from './course-scope.service'
import type { Actor } from '../../common/types/actor.type'

const curso = { id: 'c1', tenantId: 't-a', slug: 'excel-basico', instructorId: 'prof', status: 'published' }
const ator = (over: Partial<Actor> = {}): Actor => ({ uid: 'prof', tenantId: 't-a', isMatriz: false, isAdmin: false, isPlatformAdmin: false, ...over })

describe('CourseScopeService', () => {
  it('bySlug filtra pelo polo e pelo slug', async () => {
    const db = createDrizzleMock()
    withQueryResults(db, [curso])
    await new CourseScopeService(db as never).bySlug('t-a', 'excel-basico')
    const w = allWheres(db.where)[0]
    expect(w.sql).toContain('`courses`.`tenant_id` = ?')
    expect(w.sql).toContain('`courses`.`slug` = ?')
    expect(w.params).toEqual(['t-a', 'excel-basico'])
  })

  it('bySlug com publishedOnly exige status publicado', async () => {
    const db = createDrizzleMock()
    withQueryResults(db, [curso])
    await new CourseScopeService(db as never).bySlug('t-a', 'excel-basico', { publishedOnly: true })
    expect(allWheres(db.where)[0].params).toEqual(['t-a', 'excel-basico', 'published'])
  })

  it('curso de outro polo vira 404', async () => {
    const db = createDrizzleMock()
    withQueryResults(db, [])
    await expect(new CourseScopeService(db as never).byId('t-a', 'c-de-outro-polo')).rejects.toThrow(NotFoundException)
  })

  it('owned libera o dono e o admin do polo, nega o resto', async () => {
    const db = createDrizzleMock()
    const svc = new CourseScopeService(db as never)
    withQueryResults(db, [curso], [curso], [curso])
    await expect(svc.owned(ator(), 'c1')).resolves.toMatchObject({ id: 'c1' })
    await expect(svc.owned(ator({ uid: 'outro', isAdmin: true }), 'c1')).resolves.toMatchObject({ id: 'c1' })
    await expect(svc.owned(ator({ uid: 'outro' }), 'c1')).rejects.toThrow(ForbiddenException)
  })

  it('courseIdOfModule e courseIdOfLesson cruzam com o polo do curso', async () => {
    const db = createDrizzleMock()
    const svc = new CourseScopeService(db as never)
    withQueryResults(db, [{ courseId: 'c1' }], [{ courseId: 'c1' }])
    expect(await svc.courseIdOfModule('t-a', 'm1')).toBe('c1')
    expect(await svc.courseIdOfLesson('t-a', 'l1')).toBe('c1')
    const [m, l] = allWheres(db.where)
    expect(m.sql).toContain('`courses`.`tenant_id` = ?')
    expect(m.params).toEqual(['m1', 't-a'])
    expect(l.sql).toContain('`courses`.`tenant_id` = ?')
    expect(l.params).toEqual(['l1', 't-a'])
  })

  it('módulo ou aula fora do polo vira 404', async () => {
    const db = createDrizzleMock()
    const svc = new CourseScopeService(db as never)
    withQueryResults(db, [], [])
    await expect(svc.courseIdOfModule('t-a', 'm-de-outro')).rejects.toThrow('Módulo não encontrado.')
    await expect(svc.courseIdOfLesson('t-a', 'l-de-outro')).rejects.toThrow('Aula não encontrada.')
  })
})
