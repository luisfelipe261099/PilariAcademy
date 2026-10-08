/// <reference types="jest" />
import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { createDrizzleMock, withQueryResults, type DrizzleMock } from '../../__test-utils__/drizzle-mock'
import type { Actor } from '../../common/types/actor.type'
import { CourseScopeService } from '../tenancy/course-scope.service'
import { AnnouncementsService } from './announcements.service'

function make() {
  const db: DrizzleMock = createDrizzleMock()
  const scope = new CourseScopeService(db as never)
  return { db, scope, service: new AnnouncementsService(db as never, scope) }
}

const actor = (uid: string, isAdmin = false): Actor => ({ uid, tenantId: 't-a', isMatriz: false, isAdmin, isPlatformAdmin: false })

const course = { id: 'c1', slug: 'curso', title: 'Curso', instructorId: 'prof1', status: 'published' }
const ann = { id: 'a1', courseId: 'c1', authorId: 'prof1', title: 't', body: 'b', createdAt: new Date() }

describe('AnnouncementsService', () => {
  describe('create', () => {
    it('insere o anúncio quando é dono do curso', async () => {
      const { db, service } = make()
      withQueryResults(db, [course], undefined)
      const a = await service.create(actor('prof1'), 'c1', 'Aviso', 'corpo do aviso')
      expect(a.title).toBe('Aviso')
      expect(db.insert).toHaveBeenCalled()
    })

    it('resolve o curso pelo polo do ator e grava o ator como autor', async () => {
      const { db, scope, service } = make()
      const owned = jest.spyOn(scope, 'owned')
      withQueryResults(db, [course], undefined)
      const ator = actor('prof1')
      await service.create(ator, 'c1', 'Aviso', 'corpo do aviso')
      expect(owned).toHaveBeenCalledWith(ator, 'c1')
      expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ courseId: 'c1', authorId: 'prof1' }))
    })

    it('o admin do polo cria no curso de outro instrutor', async () => {
      const { db, service } = make()
      withQueryResults(db, [course], undefined)
      await service.create(actor('adm', true), 'c1', 'Aviso', 'corpo do aviso')
      expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ authorId: 'adm' }))
    })

    it('instrutor em curso de colega do mesmo polo → 403, sem inserir', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ ...course, instructorId: 'outro' }])
      await expect(service.create(actor('prof1'), 'c1', 'Aviso', 'corpo')).rejects.toBeInstanceOf(ForbiddenException)
      expect(db.insert).not.toHaveBeenCalled()
    })

    it('curso de outro polo → 404 mesmo para o admin, sem inserir', async () => {
      const { db, service } = make()
      withQueryResults(db, [])
      await expect(service.create(actor('adm', true), 'c-b', 'Aviso', 'corpo')).rejects.toBeInstanceOf(NotFoundException)
      expect(db.insert).not.toHaveBeenCalled()
    })
  })

  describe('listForStudent', () => {
    it('exige matrícula ativa → 403', async () => {
      const { db, service } = make()
      withQueryResults(db, [course], [])
      await expect(service.listForStudent('t-a', 'u1', 'curso')).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('slug que só existe em outro polo → 404', async () => {
      const { db, service } = make()
      withQueryResults(db, [])
      await expect(service.listForStudent('t-a', 'u1', 'curso')).rejects.toBeInstanceOf(NotFoundException)
    })

    it('resolve o slug pelo polo do endereço e devolve os anúncios com o autor', async () => {
      const { db, scope, service } = make()
      const bySlug = jest.spyOn(scope, 'bySlug')
      withQueryResults(db, [course], [{ id: 'e1' }], [{ a: ann, authorName: 'Prof Um' }])
      const list = await service.listForStudent('t-a', 'u1', 'curso')
      expect(bySlug).toHaveBeenCalledWith('t-a', 'curso')
      expect(list).toHaveLength(1)
      expect(list[0]).toMatchObject({ id: 'a1', courseId: 'c1', authorName: 'Prof Um' })
    })
  })

  describe('listForInstructor', () => {
    it('curso de outro polo → 404, sem listar', async () => {
      const { db, service } = make()
      withQueryResults(db, [])
      await expect(service.listForInstructor(actor('adm', true), 'c-b')).rejects.toBeInstanceOf(NotFoundException)
      expect(db.leftJoin).not.toHaveBeenCalled()
    })

    it('o dono do curso lista os anúncios', async () => {
      const { db, service } = make()
      withQueryResults(db, [course], [{ a: ann, authorName: null }])
      const list = await service.listForInstructor(actor('prof1'), 'c1')
      expect(list.map((x) => x.id)).toEqual(['a1'])
    })
  })

  describe('remove', () => {
    it('anúncio de curso alheio → 403', async () => {
      const { db, service } = make()
      withQueryResults(db, [ann], [{ ...course, instructorId: 'outro' }])
      await expect(service.remove(actor('prof1'), 'a1')).rejects.toBeInstanceOf(ForbiddenException)
      expect(db.delete).not.toHaveBeenCalled()
    })

    it('anúncio de curso de outro polo → 404, sem apagar', async () => {
      const { db, service } = make()
      withQueryResults(db, [ann], [])
      await expect(service.remove(actor('adm', true), 'a1')).rejects.toBeInstanceOf(NotFoundException)
      expect(db.delete).not.toHaveBeenCalled()
    })

    it('anúncio inexistente → 404', async () => {
      const { db, service } = make()
      withQueryResults(db, [])
      await expect(service.remove(actor('prof1'), 'aX')).rejects.toBeInstanceOf(NotFoundException)
    })

    it('o dono do curso apaga o anúncio', async () => {
      const { db, scope, service } = make()
      const owned = jest.spyOn(scope, 'owned')
      withQueryResults(db, [ann], [course], undefined)
      const ator = actor('prof1')
      await service.remove(ator, 'a1')
      expect(owned).toHaveBeenCalledWith(ator, 'c1')
      expect(db.delete).toHaveBeenCalled()
    })
  })
})
