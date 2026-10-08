import { Sparkles } from 'lucide-react'
import { CourseCard, useCoursesQuery } from '@/entities/course'

export function FeaturedSection() {
  const { data } = useCoursesQuery()
  const featured = (data ?? []).slice(0, 4)
  if (featured.length === 0) return null

  return (
    <section className="border-y border-border bg-surface">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-2 text-sm font-bold tracking-wider text-brand-bright uppercase">
            <Sparkles className="size-4" aria-hidden="true" /> Em destaque
          </span>
          <h2 className="mt-2 text-3xl font-bold text-ink sm:text-4xl">Comece por aqui</h2>
          <p className="mt-3 text-muted">Os cursos escolhidos pela Dra. Mylena Sestream para o seu primeiro passo.</p>
        </div>
        <div className="mt-8 grid grid-cols-1 auto-rows-fr gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {featured.map((course) => (
            <CourseCard key={course.id} course={course} />
          ))}
        </div>
      </div>
    </section>
  )
}
