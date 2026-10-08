import { Search, X } from 'lucide-react'
import type { CourseFilterValue } from '../model/useCourseFilter'

interface CourseFilterBarProps {
  query: string
  onQueryChange: (value: string) => void
  active: CourseFilterValue
  onActiveChange: (value: CourseFilterValue) => void
  filters: CourseFilterValue[]
}

export function CourseFilterBar({
  query,
  onQueryChange,
  active,
  onActiveChange,
  filters,
}: CourseFilterBarProps) {
  return (
    <div className="sticky top-16 z-30 -mx-4 mt-8 border-y border-border bg-card/90 px-4 py-3 backdrop-blur-md sm:mx-0 sm:rounded-2xl sm:border">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Buscar curso (ex.: gestantes, postura, aparelhos)…"
            aria-label="Buscar curso"
            className="w-full rounded-full border border-border bg-surface py-2.5 pr-10 pl-10 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQueryChange('')}
              aria-label="Limpar busca"
              className="absolute top-1/2 right-3 -translate-y-1/2 text-muted transition-colors hover:text-accent"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {filters.map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => onActiveChange(filter)}
              aria-pressed={active === filter}
              className={
                'rounded-full px-4 py-2 text-sm font-medium transition ' +
                (active === filter
                  ? 'bg-brand text-white shadow-sm'
                  : 'bg-card text-accent ring-1 ring-border hover:bg-brand-soft')
              }
            >
              {filter}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
