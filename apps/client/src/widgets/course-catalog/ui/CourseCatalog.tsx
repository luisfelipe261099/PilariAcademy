import { CourseCard, useCoursesQuery } from '@/entities/course'
import { useCategoriesQuery } from '@/entities/category'
import { suspendedCopy, useTenant } from '@/entities/tenant'
import { CourseFilterBar, useCourseFilter } from '@/features/course-filter'

export function CourseCatalog() {
  const coursesQuery = useCoursesQuery()
  const suspenso = suspendedCopy(useTenant())
  const categoriesQuery = useCategoriesQuery()
  const { query, setQuery, active, setActive, filters, filtered, reset } = useCourseFilter(
    coursesQuery.data ?? [],
    categoriesQuery.data ?? []
  )

  return (
    <section id="cursos" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-16 sm:px-6">
      <div className="max-w-2xl">
        <span className="text-sm font-bold tracking-wider text-brand-bright uppercase">Catálogo</span>
        <h2 className="mt-2 text-3xl font-bold text-ink sm:text-4xl">Nossos cursos</h2>
        <p className="mt-3 text-muted">
          Pilates e fisioterapia para fazer em casa, no seu ritmo. Filtre por modalidade ou busque pelo nome.
        </p>
      </div>

      <CourseFilterBar query={query} onQueryChange={setQuery} active={active} onActiveChange={setActive} filters={filters} />

      {coursesQuery.isLoading ? (
        <p className="mt-6 text-sm text-muted">Carregando cursos…</p>
      ) : coursesQuery.isError ? (
        suspenso ? <p className="mt-6 text-sm text-muted">{suspenso.catalog}</p> : <p className="mt-6 text-sm text-red-500">Não foi possível carregar os cursos.</p>
      ) : (
        <>
          <p className="mt-6 text-sm text-muted">
            {filtered.length} {filtered.length === 1 ? 'curso encontrado' : 'cursos encontrados'}
          </p>
          {filtered.length > 0 ? (
            <div className="mt-4 grid grid-cols-1 auto-rows-fr gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.map((course) => (
                <CourseCard key={course.id} course={course} />
              ))}
            </div>
          ) : (
            <div className="mt-10 rounded-2xl border border-dashed border-border bg-surface px-6 py-16 text-center">
              <p className="text-lg font-bold text-ink">Nenhum curso encontrado</p>
              <p className="mt-1 text-muted">Tente outra busca ou selecione outra categoria.</p>
              <button
                type="button"
                onClick={reset}
                className="mt-5 rounded-full bg-brand px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-dark"
              >
                Limpar filtros
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
