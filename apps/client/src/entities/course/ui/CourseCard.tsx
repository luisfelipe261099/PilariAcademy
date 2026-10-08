import { Link } from 'react-router-dom'
import { ArrowRight, Globe, Zap } from 'lucide-react'
import type { CourseSummary } from '@pilari/types'
import { formatPriceBRL } from '../lib/format-price'

export function CourseCard({ course }: { course: CourseSummary }) {
  const isExternal = course.kind === 'external'

  return (
    <Link
      to={`/curso/${course.slug}`}
      aria-label={`${course.title} — ${formatPriceBRL(course.priceInCents)}`}
      className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all duration-300 hover:-translate-y-1 hover:border-brand/40 hover:shadow-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <div className="relative aspect-16/10 overflow-hidden bg-brand-soft">
        {course.coverImageUrl && (
          <img
            src={course.coverImageUrl}
            alt={course.title}
            loading="lazy"
            decoding="async"
            style={{ objectPosition: course.coverFocus ?? '50% 100%' }}
            className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        )}
        <span
          className={
            'absolute top-3 left-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold shadow-sm ' +
            (isExternal ? 'bg-brand text-white' : 'bg-white/90 text-brand')
          }
        >
          {isExternal ? (
            <>
              <Globe className="size-3" aria-hidden="true" /> Externo
            </>
          ) : (
            <>
              <Zap className="size-3" aria-hidden="true" /> Online
            </>
          )}
        </span>
        {course.listPriceInCents != null && (
          <span className="absolute top-3 right-3 rounded-full bg-red-500 px-2.5 py-1 text-xs font-bold text-white shadow-sm">
            PROMOÇÃO
          </span>
        )}
        <span className="absolute right-4 -bottom-0 inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-sm font-bold text-white shadow-lg ring-2 ring-card">
          {course.listPriceInCents != null && (
            <span className="text-xs font-medium text-white/60 line-through">{formatPriceBRL(course.listPriceInCents)}</span>
          )}
          {formatPriceBRL(course.priceInCents)}
        </span>
      </div>

      <div className="flex flex-1 flex-col px-5 pt-5 pb-4">
        {course.category && (
          <span className="text-xs font-medium tracking-wide text-brand-bright uppercase">
            {course.category.name}
          </span>
        )}
        <h3 className="mt-1 line-clamp-2 min-h-11 text-lg leading-snug font-bold text-ink transition-colors group-hover:text-accent">
          {course.title}
        </h3>
        {course.subtitle && (
          <p className="mt-2 line-clamp-2 text-sm text-muted">{course.subtitle}</p>
        )}
        <span className="mt-auto inline-flex items-center gap-1.5 pt-3 text-sm font-bold text-accent">
          Ver curso
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
        </span>
      </div>
    </Link>
  )
}
