/// <reference types="jest" />
import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { createDrizzleMock, withQueryResults, type DrizzleMock } from '../../__test-utils__/drizzle-mock'
import { CourseScopeService } from '../tenancy/course-scope.service'
import { NotesService } from './notes.service'

function make() {
  const db: DrizzleMock = createDrizzleMock()
  const scope = new CourseScopeService(db as never)
  return { db, scope, service: new NotesService(db as never, scope) }
}

const course = { id: 'c1', slug: 'curso', title: 'Curso', instructorId: 'prof1', status: 'published' }

describe('NotesService', () => {
  describe('create', () => {
    it('insere a observação com o timestamp do vídeo', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ courseId: 'c1' }], [{ id: 'e1' }], undefined)
      const n = await service.create('t-a', 'u1', 'l1', 90, 'minha anotação')
      expect(n.atSec).toBe(90)
      expect(n.lessonId).toBe('l1')
      expect(db.insert).toHaveBeenCalled()
    })

    it('resolve a aula pelo polo do endereço e grava o curso dela', async () => {
      const { db, scope, service } = make()
      const courseIdOfLesson = jest.spyOn(scope, 'courseIdOfLesson')
      withQueryResults(db, [{ courseId: 'c1' }], [{ id: 'e1' }], undefined)
      await service.create('t-a', 'u1', 'l1', 90, 'minha anotação')
      expect(courseIdOfLesson).toHaveBeenCalledWith('t-a', 'l1')
      expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', courseId: 'c1', lessonId: 'l1' }))
    })

    it('aula de outro polo → 404, sem inserir', async () => {
      const { db, service } = make()
      withQueryResults(db, [])
      await expect(service.create('t-a', 'u1', 'l-b', 10, 'oi')).rejects.toBeInstanceOf(NotFoundException)
      expect(db.insert).not.toHaveBeenCalled()
    })

    it('sem matrícula ativa no curso da aula → 403, sem inserir', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ courseId: 'c1' }], [])
      await expect(service.create('t-a', 'u1', 'l1', 10, 'oi')).rejects.toBeInstanceOf(ForbiddenException)
      expect(db.insert).not.toHaveBeenCalled()
    })
  })

  describe('listForCourse', () => {
    it('devolve as notas do aluno com o título da aula', async () => {
      const { db, scope, service } = make()
      const bySlug = jest.spyOn(scope, 'bySlug')
      const noteRow = { n: { id: 'n1', userId: 'u1', courseId: 'c1', lessonId: 'l1', atSec: 30, body: 'x', createdAt: new Date() }, lessonTitle: 'Aula 1' }
      withQueryResults(db, [course], [{ id: 'e1' }], [noteRow])
      const list = await service.listForCourse('t-a', 'u1', 'curso')
      expect(bySlug).toHaveBeenCalledWith('t-a', 'curso')
      expect(list).toHaveLength(1)
      expect(list[0].lessonTitle).toBe('Aula 1')
    })

    it('slug que só existe em outro polo → 404', async () => {
      const { db, service } = make()
      withQueryResults(db, [])
      await expect(service.listForCourse('t-a', 'u1', 'curso')).rejects.toBeInstanceOf(NotFoundException)
    })
  })

  describe('remove', () => {
    it('observação inexistente → 404', async () => {
      const { db, service } = make()
      withQueryResults(db, [])
      await expect(service.remove('t-a', 'u1', 'nX')).rejects.toBeInstanceOf(NotFoundException)
    })

    it('observação de curso de outro polo → 404, sem apagar', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ id: 'n1', courseId: 'c-b' }], [])
      await expect(service.remove('t-a', 'u1', 'n1')).rejects.toBeInstanceOf(NotFoundException)
      expect(db.delete).not.toHaveBeenCalled()
    })

    it('apaga a observação cujo curso é do polo do endereço', async () => {
      const { db, scope, service } = make()
      const byId = jest.spyOn(scope, 'byId')
      withQueryResults(db, [{ id: 'n1', courseId: 'c1' }], [course], undefined)
      await service.remove('t-a', 'u1', 'n1')
      expect(byId).toHaveBeenCalledWith('t-a', 'c1')
      expect(db.delete).toHaveBeenCalled()
    })
  })
})
