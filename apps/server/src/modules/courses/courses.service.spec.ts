/// <reference types="jest" />
import { NotFoundException } from '@nestjs/common'
import { createDrizzleMock, withQueryResults, type DrizzleMock } from '../../__test-utils__/drizzle-mock'
import { allWheres } from '../../__test-utils__/sql'
import { CoursesService } from './courses.service'

function make() {
  const db: DrizzleMock = createDrizzleMock()
  // GcsService: resolve o vídeo da prévia para uma URL tocável (aqui devolve o próprio valor).
  const gcs = { playableUrl: jest.fn(async (v: string | null) => v), signedUrl: jest.fn(async (v: string | null) => v) }
  const service = new CoursesService(db as never, gcs as never)
  return { db, service, gcs }
}

// Linha "achatada" do join courses+categories+users que o select retorna.
function joinedRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    course: {
      id: 'c1', slug: 'curso-um', instructorId: 'u1', categoryId: 'cat1', kind: 'online',
      title: 'Curso Um', subtitle: 'sub', description: 'desc', priceInCents: 9700,
      coverImageUrl: 'http://img', status: 'published', externalUrl: null,
      publishedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
    },
    category: { id: 'cat1', name: 'Tecnologia', slug: 'tecnologia' },
    instructorName: 'Prof. Tiago',
    ...over,
  }
}

describe('CoursesService', () => {
  it('lista cursos publicados como CourseSummary', async () => {
    const { db, service } = make()
    withQueryResults(db, [joinedRow()])
    const result = await service.listPublished('t-a')
    expect(result).toEqual([
      {
        id: 'c1', slug: 'curso-um', title: 'Curso Um', subtitle: 'sub', kind: 'online',
        priceInCents: 9700, listPriceInCents: null, promoEndsAt: null, coverImageUrl: 'http://img', coverFocus: null,
        category: { id: 'cat1', name: 'Tecnologia', slug: 'tecnologia' },
        instructorName: 'Prof. Tiago',
        availableAt: null,
      },
    ])
  })

  it('getPublishedBySlug lança 404 quando não há curso publicado', async () => {
    const { db, service } = make()
    withQueryResults(db, []) // nenhum curso
    await expect(service.getPublishedBySlug('t-a', 'nada')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('detalhe de curso online inclui módulos e aulas ordenados', async () => {
    const { db, service } = make()
    withQueryResults(
      db,
      [joinedRow()], // curso
      [{ id: 'm1', courseId: 'c1', title: 'Mód 1', order: 0 }], // módulos
      [
        { id: 'l1', moduleId: 'm1', title: 'Aula 1', description: null, videoUrl: 'v', durationSec: 60, order: 0, isFreePreview: true },
        { id: 'l2', moduleId: 'm1', title: 'Aula 2', description: null, videoUrl: 'segredo', durationSec: 90, order: 1, isFreePreview: false },
      ] // aulas do módulo m1
    )
    const detail = await service.getPublishedBySlug('t-a', 'curso-um')
    expect(detail.modules).toHaveLength(1)
    // Prévia grátis: expõe o vídeo (tocável).
    expect(detail.modules[0].lessons[0]).toEqual({
      id: 'l1', title: 'Aula 1', description: null, videoUrl: 'v', durationSec: 60, order: 0, isFreePreview: true,
    })
    // Aula paga: NUNCA vaza o vídeo no endpoint público.
    expect(detail.modules[0].lessons[1].videoUrl).toBeNull()
  })

  it('curso externo tem modules vazio', async () => {
    const { db, service } = make()
    withQueryResults(
      db,
      [joinedRow({ course: { ...joinedRow().course, kind: 'external', externalUrl: 'http://x' } })]
    )
    const detail = await service.getPublishedBySlug('t-a', 'curso-um')
    expect(detail.kind).toBe('external')
    expect(detail.modules).toEqual([])
  })

  it('listPublished filtra pelo polo e por publicado', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    await service.listPublished('t-a', {})
    const w = allWheres(db.where)[0]
    expect(w.sql).toContain('`courses`.`tenant_id` = ?')
    expect(w.params.slice(0, 2)).toEqual(['t-a', 'published'])
  })

  it('getPublishedBySlug procura o slug dentro do polo', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    await expect(service.getPublishedBySlug('t-a', 'excel-basico')).rejects.toThrow('Curso não encontrado.')
    expect(allWheres(db.where)[0].params).toEqual(['t-a', 'excel-basico', 'published'])
  })

  it('coverImage de objeto do bucket lê com o teto de imagem (5 MB)', async () => {
    const { db, gcs, service } = make()
    const readObject = jest.fn(async () => ({ buffer: Buffer.from('png'), contentType: 'image/png' }))
    Object.assign(gcs, { readObject })
    withQueryResults(db, [{ cover: 'cursos/c1/cover/capa.png' }])
    expect(await service.coverImage('t-a', 'c1')).toEqual({ kind: 'image', buffer: Buffer.from('png'), contentType: 'image/png' })
    expect(readObject).toHaveBeenCalledWith('cursos/c1/cover/capa.png', { maxBytes: 5 * 1024 * 1024 })
  })

  it('coverImage não serve capa de curso de outro polo', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    expect(await service.coverImage('t-a', 'c-de-outro')).toBeNull()
    expect(allWheres(db.where)[0].params).toEqual(['t-a', 'c-de-outro'])
  })
})
