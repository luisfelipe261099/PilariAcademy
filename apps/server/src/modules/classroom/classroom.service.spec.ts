/// <reference types="jest" />
import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { createDrizzleMock, withQueryResults, type DrizzleMock } from '../../__test-utils__/drizzle-mock'
import { CourseScopeService } from '../tenancy/course-scope.service'
import { ClassroomService } from './classroom.service'

function make() {
  const db: DrizzleMock = createDrizzleMock()
  const gcs = {
    signedUrl: jest.fn(async (p: string | null) => (p ? 'http://signed' : null)),
    playableUrl: jest.fn(async (p: string | null) => (p ? 'http://signed' : null)),
  }
  const fileProxy = {
    proxyPdfUrl: jest.fn((id: string) => `/api/files/attachments/${id}/pdf?exp=1&sig=x`),
  }
  const scope = new CourseScopeService(db as never)
  return { db, gcs, fileProxy, service: new ClassroomService(db as never, gcs as never, fileProxy as never, scope) }
}

const course = { id: 'c1', slug: 'curso', title: 'Curso', status: 'published' }
const POLO_A = { id: 't-a', isMatriz: false }
const MATRIZ = { id: 't-m', isMatriz: true }

describe('ClassroomService', () => {
  it('sem matrícula ativa → 403', async () => {
    const { db, service } = make()
    withQueryResults(db, [course], [])
    await expect(service.getClassroom(POLO_A, 'u1', 'curso')).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('monta a sala com vídeo assinado e progresso', async () => {
    const { db, service } = make()
    withQueryResults(
      db,
      [course],
      [{ id: 'e1', status: 'active' }], // matrícula ativa
      [{ id: 'm1', courseId: 'c1', title: 'Mód', order: 0 }], // módulos
      [{ id: 'l1', moduleId: 'm1', title: 'Aula', description: null, videoUrl: 'path/v.mp4', durationSec: 60, order: 0 }], // aulas
      [], // anexos
      [{ lessonId: 'l1', completed: true }], // progresso
      [], // módulos com prova
      [], // provas aprovadas
      [{ cpf: '123.456.789-01', displayName: 'Ana Maria' }] // users: cpf + nome
    )
    const c = await service.getClassroom(POLO_A, 'u1', 'curso')
    expect(c.modules[0].lessons[0].signedVideoUrl).toBe('http://signed')
    expect(c.modules[0].lessons[0].completed).toBe(true)
    expect(c.modules[0].hasQuiz).toBe(false)
    expect(c.progressPercent).toBe(100)
    expect(c.hasCpf).toBe(true)
    expect(c.hasName).toBe(true)
  })

  describe('curso fora do ar (rascunho, em análise, arquivado)', () => {
    it.each(['draft', 'in_review', 'archived'])('%s: o matriculado recebe 403 COURSE_UNAVAILABLE e a sala não é montada', async (status) => {
      const { db, service } = make()
      withQueryResults(db, [{ ...course, status }], [{ id: 'e1', status: 'active' }])
      const erro = await service.getClassroom(POLO_A, 'u1', 'curso').then(() => null, (e: unknown) => e)
      expect(erro).toBeInstanceOf(ForbiddenException)
      expect((erro as ForbiddenException).getResponse()).toEqual({
        statusCode: 403, code: 'COURSE_UNAVAILABLE', message: 'Este curso está indisponível no momento. Fale com o seu polo.',
      })
      expect(db.select).toHaveBeenCalledTimes(2) // curso e matrícula: nada de módulos
    })

    it('na matriz o aviso não manda falar com o polo', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ ...course, status: 'draft' }], [{ id: 'e1', status: 'active' }])
      await expect(service.getClassroom(MATRIZ, 'u1', 'curso')).rejects.toMatchObject({
        response: { statusCode: 403, code: 'COURSE_UNAVAILABLE', message: 'Este curso está indisponível no momento.' },
      })
    })

    it('sem matrícula ativa: 404, como se o curso não existisse', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ ...course, status: 'draft' }], [])
      await expect(service.getClassroom(POLO_A, 'u1', 'curso')).rejects.toBeInstanceOf(NotFoundException)
    })
  })
})
