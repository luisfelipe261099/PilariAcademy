/// <reference types="jest" />
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { createDrizzleMock, withQueryResults, type DrizzleMock } from '../../__test-utils__/drizzle-mock'
import { CourseScopeService } from '../tenancy/course-scope.service'
import { ReviewsService } from './reviews.service'

function make() {
  const db: DrizzleMock = createDrizzleMock()
  const scope = new CourseScopeService(db as never)
  return { db, scope, service: new ReviewsService(db as never, scope) }
}

const course = { id: 'c1', slug: 'curso', title: 'Curso', instructorId: 'prof1', status: 'published' }

describe('ReviewsService', () => {
  it('listForCourse calcula a média e acha a minha avaliação', async () => {
    const { db, service } = make()
    const rows = [
      { r: { id: 'r1', courseId: 'c1', userId: 'u1', rating: 4, comment: 'bom', createdAt: new Date() }, name: 'Ana' },
      { r: { id: 'r2', courseId: 'c1', userId: 'u2', rating: 5, comment: null, createdAt: new Date() }, name: 'Beto' },
    ]
    withQueryResults<unknown[]>(db, [course], rows)
    const res = await service.listForCourse('t-a', 'curso', 'u1')
    expect(res.count).toBe(2)
    expect(res.average).toBe(4.5)
    expect(res.mine?.id).toBe('r1')
  })

  it('listForCourse (aluno logado) resolve o slug pelo polo do endereço, só curso publicado, como a rota pública', async () => {
    const { db, scope, service } = make()
    const bySlug = jest.spyOn(scope, 'bySlug')
    withQueryResults<unknown[]>(db, [course], [])
    const res = await service.listForCourse('t-a', 'curso')
    expect(bySlug).toHaveBeenCalledWith('t-a', 'curso', { publishedOnly: true })
    expect(res).toEqual({ average: 0, count: 0, mine: null, reviews: [] })
  })

  it('listForCourse de curso fora do ar → 404, e as avaliações nem são lidas', async () => {
    const { db, service } = make()
    withQueryResults<unknown[]>(db, [])
    await expect(service.listForCourse('t-a', 'rascunho', 'u1')).rejects.toThrow('Curso não encontrado.')
    expect(db.select).toHaveBeenCalledTimes(1)
  })

  it('listPublic (página do curso) só acha curso publicado do polo: fora do ar é 404 e as avaliações nem são lidas', async () => {
    const { db, scope, service } = make()
    const bySlug = jest.spyOn(scope, 'bySlug')
    withQueryResults<unknown[]>(db, [])
    await expect(service.listPublic('t-a', 'rascunho')).rejects.toThrow('Curso não encontrado.')
    expect(bySlug).toHaveBeenCalledWith('t-a', 'rascunho', { publishedOnly: true })
    expect(db.select).toHaveBeenCalledTimes(1)
  })

  it('listPublic de curso publicado traz a média, sem "a minha" e sem o UID de quem avaliou', async () => {
    const { db, service } = make()
    const rows = [{ r: { id: 'r1', courseId: 'c1', userId: 'u1', rating: 4, comment: 'bom', createdAt: new Date() }, name: 'Ana' }]
    withQueryResults<unknown[]>(db, [course], rows)
    const res = await service.listPublic('t-a', 'curso')
    expect(res).toMatchObject({ average: 4, count: 1, mine: null })
    expect(res.reviews[0]).toMatchObject({ userId: null, userName: 'Ana' })
  })

  it('listForCourse com slug que só existe em outro polo → 404', async () => {
    const { db, service } = make()
    withQueryResults<unknown[]>(db, [])
    await expect(service.listForCourse('t-a', 'curso')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('upsertMine insere uma nova avaliação', async () => {
    const { db, scope, service } = make()
    const bySlug = jest.spyOn(scope, 'bySlug')
    withQueryResults(db, [course], [{ id: 'e1' }], [], undefined)
    const r = await service.upsertMine('t-a', 'u1', 'curso', 5, 'excelente')
    expect(r.rating).toBe(5)
    expect(bySlug).toHaveBeenCalledWith('t-a', 'curso')
    expect(db.insert).toHaveBeenCalled()
  })

  it('upsertMine rejeita nota fora de 1..5', async () => {
    const { service } = make()
    await expect(service.upsertMine('t-a', 'u1', 'curso', 9, null)).rejects.toBeInstanceOf(BadRequestException)
  })

  it('upsertMine com slug que só existe em outro polo → 404, sem gravar', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    await expect(service.upsertMine('t-a', 'u1', 'curso', 5, null)).rejects.toBeInstanceOf(NotFoundException)
    expect(db.insert).not.toHaveBeenCalled()
    expect(db.update).not.toHaveBeenCalled()
  })

  it('aluno não matriculado não pode avaliar → 403', async () => {
    const { db, service } = make()
    withQueryResults(db, [course], [])
    await expect(service.upsertMine('t-a', 'u1', 'curso', 5, null)).rejects.toBeInstanceOf(ForbiddenException)
  })
})
