/// <reference types="jest" />
import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { createDrizzleMock, withQueryResults, type DrizzleMock } from '../../__test-utils__/drizzle-mock'
import { CourseScopeService } from '../tenancy/course-scope.service'
import { ProgressService } from './progress.service'

function make() {
  const db: DrizzleMock = createDrizzleMock()
  const scope = new CourseScopeService(db as never)
  return { db, service: new ProgressService(db as never, scope) }
}

describe('ProgressService', () => {
  it('aula inexistente → 404', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    await expect(service.setProgress('t-a', 'u1', 'nope', true)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('sem matrícula ativa → 403', async () => {
    const { db, service } = make()
    withQueryResults(db, [{ courseId: 'c1' }], [])
    await expect(service.setProgress('t-a', 'u1', 'l1', true)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('matriculado → upsert (insert) e retorna completed', async () => {
    const { db, service } = make()
    withQueryResults(db, [{ courseId: 'c1' }], [{ id: 'e', status: 'active' }], [], undefined)
    const res = await service.setProgress('t-a', 'u1', 'l1', true)
    expect(res.completed).toBe(true)
    expect(db.insert).toHaveBeenCalled()
  })
})
