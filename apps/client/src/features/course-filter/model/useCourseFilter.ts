import { useMemo, useState } from 'react'
import type { Category, CourseSummary } from '@pilari/types'

export type CourseFilterValue = string // 'Todos' ou o nome de uma categoria

/** Filtragem pura (testável): por categoria (nome) + busca textual. */
export function filterCourses(
  courses: CourseSummary[],
  active: CourseFilterValue,
  query: string
): CourseSummary[] {
  const q = query.trim().toLowerCase()
  return courses.filter((c) => {
    const matchesCat = active === 'Todos' || c.category?.name === active
    const matchesQuery =
      q === '' ||
      c.title.toLowerCase().includes(q) ||
      (c.subtitle ?? '').toLowerCase().includes(q) ||
      (c.category?.name ?? '').toLowerCase().includes(q)
    return matchesCat && matchesQuery
  })
}

export function useCourseFilter(courses: CourseSummary[], categories: Category[]) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<CourseFilterValue>('Todos')

  const filtered = useMemo(() => filterCourses(courses, active, query), [courses, active, query])
  const filters: CourseFilterValue[] = ['Todos', ...categories.map((c) => c.name)]

  function reset() {
    setQuery('')
    setActive('Todos')
  }

  return { query, setQuery, active, setActive, filters, filtered, reset }
}

export type UseCourseFilter = ReturnType<typeof useCourseFilter>
