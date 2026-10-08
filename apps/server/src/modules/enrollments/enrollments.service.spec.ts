/// <reference types="jest" />
import { createDrizzleMock, withQueryResults, type DrizzleMock } from '../../__test-utils__/drizzle-mock'
import { allWheres } from '../../__test-utils__/sql'
import { EnrollmentsService } from './enrollments.service'

function make() {
  const db: DrizzleMock = createDrizzleMock()
  return { db, service: new EnrollmentsService(db as never) }
}

function joined(over: Record<string, unknown> = {}) {
  return {
    enrollment: { id: 'e1', userId: 'u1', courseId: 'c1', status: 'active', source: 'purchase' },
    course: { id: 'c1', slug: 'curso', title: 'Curso', subtitle: null, kind: 'online', priceInCents: 14900, coverImageUrl: null },
    category: { id: 'cat', name: 'Tecnologia', slug: 'tecnologia' },
    ...over,
  }
}

describe('EnrollmentsService', () => {
  it('lista matrículas do aluno como Enrollment com progressPercent', async () => {
    const { db, service } = make()
    withQueryResults(
      db,
      [joined()],
      [{ courseId: 'c1', total: 2 }], // total de aulas do curso
      [{ courseId: 'c1', done: 1 }] // aulas concluídas pelo aluno
    )
    const res = await service.listForUser('t-a', 'u1')
    expect(res).toEqual([
      {
        id: 'e1', courseId: 'c1', status: 'active', source: 'purchase', paymentStatus: null, progressPercent: 50,
        course: {
          id: 'c1', slug: 'curso', title: 'Curso', subtitle: null, kind: 'online', priceInCents: 14900,
          listPriceInCents: null, promoEndsAt: null, coverImageUrl: null, coverFocus: null, category: { id: 'cat', name: 'Tecnologia', slug: 'tecnologia' }, instructorName: null,
          availableAt: null,
        },
      },
    ])
  })

  it('lista só as matrículas em cursos do polo', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    await service.listForUser('t-a', 'u1')
    const w = allWheres(db.where)[0]
    expect(w.sql).toContain('`enrollments`.`user_id` = ?')
    expect(w.sql).toContain('`courses`.`tenant_id` = ?')
    expect(w.params).toEqual(['u1', 't-a'])
  })
})
