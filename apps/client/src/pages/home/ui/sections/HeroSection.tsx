import { useState, type FormEvent } from 'react'
import { Award, PlayCircle, Search, ShieldCheck } from 'lucide-react'
import { useCoursesQuery, formatPriceBRL } from '@/entities/course'
import { useCategoriesQuery } from '@/entities/category'
import { useTenant } from '@/entities/tenant'
import { heroCopy } from '@/shared/lib/brand-copy'

function scrollToCatalog() {
  document.getElementById('cursos')?.scrollIntoView({ behavior: 'smooth' })
}

function ShowcaseCard({
  title,
  imageUrl,
  focus,
  price,
}: {
  title: string
  imageUrl: string
  focus?: string | null
  price: string
}) {
  return (
    <figure className="relative overflow-hidden rounded-2xl shadow-xl shadow-brand/15 ring-1 ring-border">
      <img src={imageUrl} alt={title} loading="lazy" style={{ objectPosition: focus ?? '50% 100%' }} className="aspect-[4/3] w-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-t from-brand-overlay/80 to-transparent" />
      <figcaption className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 p-3">
        <span className="line-clamp-1 text-sm font-bold text-white drop-shadow">{title}</span>
        <span className="shrink-0 rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-white">
          {price}
        </span>
      </figcaption>
    </figure>
  )
}

export function HeroSection() {
  const coursesQuery = useCoursesQuery()
  const categoriesQuery = useCategoriesQuery()
  const [query, setQuery] = useState('')

  const total = coursesQuery.data?.length ?? 0
  const tenant = useTenant()
  const copy = heroCopy(
    { isMatriz: tenant.isMatriz, name: tenant.name, heroTitle: tenant.branding.heroTitle, heroSubtitle: tenant.branding.heroSubtitle },
    total
  )
  const categories = categoriesQuery.data ?? []
  const showcase = (coursesQuery.data ?? []).filter((c) => c.coverImageUrl).slice(0, 4)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    scrollToCatalog()
  }

  return (
    <section className="relative isolate overflow-hidden bg-gradient-to-b from-card to-brand-soft text-ink">
      {/* grid malhado roxo */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(var(--grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--grid-line) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
        }}
      />
      {/* brilho roxo suave para profundidade */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(55% 50% at 15% 0%, color-mix(in srgb, var(--color-brand-bright) 14%, transparent), transparent 60%)',
        }}
      />

      <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:py-24">
        {/* ESQUERDA */}
        <div className="animate-fade-up">
          <span className="inline-flex items-center gap-2 rounded-full bg-accent/10 px-3 py-1 text-xs font-medium tracking-wider text-accent uppercase ring-1 ring-accent/15">
            {copy.badge}
          </span>

          <h1 className="mt-5 text-4xl leading-[1.05] font-bold sm:text-5xl lg:text-6xl">
            {copy.title}
            {copy.highlight && (
              <span className="bg-gradient-to-r from-accent to-brand-bright bg-clip-text text-transparent">{copy.highlight}</span>
            )}
          </h1>

          <p className="mt-5 max-w-xl text-lg text-muted">{copy.subtitle}</p>

          {/* BUSCA — leva ao catálogo */}
          <form onSubmit={handleSubmit} className="mt-8 max-w-xl">
            <div className="flex items-center gap-2 rounded-2xl bg-card p-2 shadow-xl shadow-brand/10 ring-1 ring-border">
              <Search className="ml-2 size-5 shrink-0 text-muted" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="O que você quer aprender?"
                aria-label="Buscar curso"
                className="min-w-0 flex-1 bg-transparent py-2 text-ink outline-none placeholder:text-muted"
              />
              <button
                type="submit"
                className="shrink-0 rounded-xl bg-brand px-5 py-2.5 font-bold text-white transition-colors hover:bg-brand-dark"
              >
                Buscar
              </button>
            </div>
          </form>

          {/* CHIPS de categoria */}
          {categories.length > 0 && (
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted">Populares:</span>
              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={scrollToCatalog}
                  className="rounded-full bg-card px-3 py-1 text-sm font-medium text-accent ring-1 ring-border transition hover:bg-brand-soft"
                >
                  {category.name}
                </button>
              ))}
            </div>
          )}

          {/* TRUST */}
          <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-muted">
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="size-5 text-accent" aria-hidden="true" />
              {copy.trust[0]}
            </span>
            <span className="inline-flex items-center gap-2">
              <Award className="size-5 text-accent" aria-hidden="true" />
              {copy.trust[1]}
            </span>
            <span className="inline-flex items-center gap-2">
              <PlayCircle className="size-5 text-accent" aria-hidden="true" />
              {copy.trust[2]}
            </span>
          </div>
        </div>

        {/* DIREITA — vitrine com cursos reais */}
        {showcase.length > 0 && (
          <div className="relative hidden lg:block">
            <div
              aria-hidden="true"
              className="absolute -inset-8 rounded-[2.5rem] bg-brand-bright/15 blur-3xl"
            />
            <div className="relative grid grid-cols-2 gap-4">
              <div className="space-y-4">
                {showcase.slice(0, 2).map((course) => (
                  <ShowcaseCard
                    key={course.id}
                    title={course.title}
                    imageUrl={course.coverImageUrl ?? ''}
                    focus={course.coverFocus}
                    price={formatPriceBRL(course.priceInCents)}
                  />
                ))}
              </div>
              <div className="space-y-4 pt-10">
                {showcase.slice(2, 4).map((course) => (
                  <ShowcaseCard
                    key={course.id}
                    title={course.title}
                    imageUrl={course.coverImageUrl ?? ''}
                    focus={course.coverFocus}
                    price={formatPriceBRL(course.priceInCents)}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
