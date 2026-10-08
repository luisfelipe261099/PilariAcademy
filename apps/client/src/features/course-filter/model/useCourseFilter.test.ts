import { describe, it, expect } from 'vitest'
import { filterCourses } from './useCourseFilter'
import type { CourseSummary } from '@pilari/types'

const base: CourseSummary = {
  id: '1', slug: 'excel', title: 'Excel Básico', subtitle: null, kind: 'online',
  priceInCents: 9700, coverImageUrl: null,
  category: { id: 'c', name: 'Tecnologia', slug: 'tecnologia' }, instructorName: null, availableAt: null, coverFocus: null,
  listPriceInCents: null, promoEndsAt: null,
}
const list: CourseSummary[] = [
  base,
  { ...base, id: '2', slug: 'mkt', title: 'Marketing Digital', category: { id: 'm', name: 'Marketing & Vendas', slug: 'marketing-vendas' } },
]

describe('filterCourses', () => {
  it('"Todos" retorna tudo', () => {
    expect(filterCourses(list, 'Todos', '')).toHaveLength(2)
  })
  it('filtra por categoria', () => {
    expect(filterCourses(list, 'Tecnologia', '')).toEqual([base])
  })
  it('filtra por busca no título', () => {
    expect(filterCourses(list, 'Todos', 'marketing')).toHaveLength(1)
  })
})
