/// <reference types="jest" />
import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { createDrizzleMock, withQueryResults, type DrizzleMock } from '../../__test-utils__/drizzle-mock'
import { allWheres } from '../../__test-utils__/sql'
import type { Actor } from '../../common/types/actor.type'
import { CourseScopeService } from '../tenancy/course-scope.service'
import { MessagesService } from './messages.service'

function make() {
  const db: DrizzleMock = createDrizzleMock()
  const scope = new CourseScopeService(db as never)
  return { db, scope, service: new MessagesService(db as never, scope) }
}

const actor = (uid: string, isAdmin = false): Actor => ({ uid, tenantId: 't-a', isMatriz: false, isAdmin, isPlatformAdmin: false })

const course = { id: 'c1', slug: 'curso', title: 'Curso', instructorId: 'prof1', status: 'published' }

describe('MessagesService', () => {
  describe('aluno', () => {
    it('studentSend grava com senderId == studentId (fromStudent)', async () => {
      const { db, service } = make()
      withQueryResults(db, [course], [{ id: 'e1' }], undefined)
      const m = await service.studentSend('t-a', 'stu1', 'curso', 'oi prof')
      expect(m.fromStudent).toBe(true)
      expect(m.senderId).toBe('stu1')
      expect(m.studentId).toBe('stu1')
      expect(m.courseId).toBe('c1')
      expect(m.body).toBe('oi prof')
      expect(db.insert).toHaveBeenCalled()
    })

    it('resolve o slug pelo polo do endereço, nas duas operações', async () => {
      const { db, scope, service } = make()
      const bySlug = jest.spyOn(scope, 'bySlug')
      withQueryResults(db, [course], [{ id: 'e1' }], undefined, [course], [{ id: 'e1' }], undefined, [])
      await service.studentSend('t-a', 'stu1', 'curso', 'oi')
      await service.studentThread('t-a', 'stu1', 'curso')
      expect(bySlug).toHaveBeenNthCalledWith(1, 't-a', 'curso')
      expect(bySlug).toHaveBeenNthCalledWith(2, 't-a', 'curso')
    })

    it('studentThread devolve mensagens e marca as recebidas como lidas', async () => {
      const { db, service } = make()
      const msgRow = { id: 'm1', courseId: 'c1', studentId: 'stu1', senderId: 'prof1', body: 'olá', readAt: null, createdAt: new Date() }
      withQueryResults(db, [course], [{ id: 'e1' }], undefined, [msgRow])
      const t = await service.studentThread('t-a', 'stu1', 'curso')
      expect(t.messages).toHaveLength(1)
      expect(t.messages[0].fromStudent).toBe(false)
      expect(db.update).toHaveBeenCalled()
    })

    it('aluno não matriculado → 403, sem gravar', async () => {
      const { db, service } = make()
      withQueryResults(db, [course], [], [course], [])
      await expect(service.studentThread('t-a', 'stu1', 'curso')).rejects.toBeInstanceOf(ForbiddenException)
      await expect(service.studentSend('t-a', 'stu1', 'curso', 'oi')).rejects.toBeInstanceOf(ForbiddenException)
      expect(db.insert).not.toHaveBeenCalled()
    })

    it('slug que só existe em outro polo → 404, sem gravar nem marcar como lido', async () => {
      const { db, service } = make()
      withQueryResults(db, [], [])
      await expect(service.studentSend('t-a', 'stu1', 'curso', 'oi')).rejects.toBeInstanceOf(NotFoundException)
      await expect(service.studentThread('t-a', 'stu1', 'curso')).rejects.toBeInstanceOf(NotFoundException)
      expect(db.insert).not.toHaveBeenCalled()
      expect(db.update).not.toHaveBeenCalled()
    })
  })

  describe('instrutor', () => {
    it('instructorThread de curso alheio no mesmo polo → 403, sem marcar como lido', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ ...course, instructorId: 'outro' }])
      await expect(service.instructorThread(actor('prof1'), 'c1', 'stu1')).rejects.toBeInstanceOf(ForbiddenException)
      expect(db.update).not.toHaveBeenCalled()
    })

    it('instructorThread de curso de outro polo → 404 mesmo para o admin, sem marcar como lido', async () => {
      const { db, service } = make()
      withQueryResults(db, [])
      await expect(service.instructorThread(actor('adm', true), 'c-b', 'stu1')).rejects.toBeInstanceOf(NotFoundException)
      expect(db.update).not.toHaveBeenCalled()
    })

    it('o dono do curso lê a conversa e marca as mensagens do aluno como lidas', async () => {
      const { db, scope, service } = make()
      const owned = jest.spyOn(scope, 'owned')
      const msgRow = { id: 'm1', courseId: 'c1', studentId: 'stu1', senderId: 'stu1', body: 'dúvida', readAt: null, createdAt: new Date() }
      withQueryResults(db, [course], undefined, [msgRow], [{ name: 'Aluno X' }])
      const ator = actor('prof1')
      const t = await service.instructorThread(ator, 'c1', 'stu1')
      expect(owned).toHaveBeenCalledWith(ator, 'c1')
      expect(t).toMatchObject({ courseId: 'c1', courseTitle: 'Curso', studentId: 'stu1', studentName: 'Aluno X' })
      expect(t.messages.map((m) => m.body)).toEqual(['dúvida'])
      expect(db.update).toHaveBeenCalled()
    })

    it('o admin do polo lê a conversa de curso de outro instrutor', async () => {
      const { db, service } = make()
      withQueryResults(db, [course], undefined, [], [])
      const t = await service.instructorThread(actor('adm', true), 'c1', 'stu1')
      expect(t.courseId).toBe('c1')
      expect(t.studentName).toBeNull()
    })

    describe('instructorSend', () => {
      it('o dono do curso grava a resposta com o instrutor como remetente', async () => {
        const { db, scope, service } = make()
        const owned = jest.spyOn(scope, 'owned')
        withQueryResults(db, [course], undefined)
        const ator = actor('prof1')
        const m = await service.instructorSend(ator, 'c1', 'stu1', 'resposta')
        expect(owned).toHaveBeenCalledWith(ator, 'c1')
        expect(m).toMatchObject({ courseId: 'c1', studentId: 'stu1', senderId: 'prof1', fromStudent: false, body: 'resposta' })
        expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ courseId: 'c1', studentId: 'stu1', senderId: 'prof1' }))
      })

      it('o admin do polo responde em curso de outro instrutor, como remetente', async () => {
        const { db, service } = make()
        withQueryResults(db, [course], undefined)
        const m = await service.instructorSend(actor('adm', true), 'c1', 'stu1', 'resposta')
        expect(m.senderId).toBe('adm')
      })

      it('curso alheio no mesmo polo → 403, sem gravar', async () => {
        const { db, service } = make()
        withQueryResults(db, [{ ...course, instructorId: 'outro' }])
        await expect(service.instructorSend(actor('prof1'), 'c1', 'stu1', 'x')).rejects.toBeInstanceOf(ForbiddenException)
        expect(db.insert).not.toHaveBeenCalled()
      })

      it('curso de outro polo → 404 mesmo para o admin, sem gravar', async () => {
        const { db, service } = make()
        withQueryResults(db, [])
        await expect(service.instructorSend(actor('adm', true), 'c-b', 'stu1', 'x')).rejects.toBeInstanceOf(NotFoundException)
        expect(db.insert).not.toHaveBeenCalled()
      })
    })

    describe('instructorConversations', () => {
      const m1 = { id: 'm1', courseId: 'c1', studentId: 'stu1', senderId: 'stu1', body: 'primeira', readAt: null, createdAt: new Date('2026-06-01') }
      const m2 = { id: 'm2', courseId: 'c1', studentId: 'stu1', senderId: 'stu1', body: 'segunda', readAt: null, createdAt: new Date('2026-06-02') }

      it('agrupa por conversa e conta não lidas', async () => {
        const { db, service } = make()
        withQueryResults(db, [{ id: 'c1', title: 'Curso' }], [m1, m2], [{ uid: 'stu1', name: 'Aluno X' }])
        const convos = await service.instructorConversations(actor('prof1'))
        expect(convos).toHaveLength(1)
        expect(convos[0].studentName).toBe('Aluno X')
        expect(convos[0].lastBody).toBe('segunda')
        expect(convos[0].unread).toBe(2)
      })

      it('o instrutor lista só os cursos dele neste polo', async () => {
        const { db, service } = make()
        withQueryResults(db, [])
        await service.instructorConversations(actor('prof1'))
        const [cursos] = allWheres(db.where)
        expect(cursos.sql).toContain('`courses`.`tenant_id` = ?')
        expect(cursos.sql).toContain('`courses`.`instructor_id` = ?')
        expect(cursos.params).toEqual(['t-a', 'prof1'])
      })

      it('o admin lista todos os cursos do polo, e só do polo', async () => {
        const { db, service } = make()
        withQueryResults(db, [])
        await service.instructorConversations(actor('adm', true))
        const [cursos] = allWheres(db.where)
        expect(cursos.sql).toContain('`courses`.`tenant_id` = ?')
        expect(cursos.sql).not.toContain('instructor_id')
        expect(cursos.params).toEqual(['t-a'])
      })

      it('sem curso no polo, devolve vazio sem buscar mensagens', async () => {
        const { db, service } = make()
        withQueryResults(db, [])
        expect(await service.instructorConversations(actor('prof1'))).toEqual([])
        expect(db.select).toHaveBeenCalledTimes(1)
      })
    })
  })
})
