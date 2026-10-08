import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowUpRight, CalendarClock, Check, Lock, PlayCircle, ShoppingCart, UserCircle, X } from 'lucide-react'
import type { Lesson } from '@pilari/types'
import { useCourseQuery, formatPriceBRL } from '@/entities/course'
import { EnrollViaPoloButton, suspendedCopy, useTenant } from '@/entities/tenant'
import { preSaleLead } from '@/shared/lib/brand-copy'

/** Data ISO futura formatada (pt-BR) ou null se ausente/passada. */
function preSaleDate(iso: string | null): string | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (t <= Date.now()) return null
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' })
}
import { useMyEnrollmentsQuery } from '@/entities/enrollment'
import { useCart } from '@/shared/cart'

export function CourseDetailPage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const tenant = useTenant()
  const { data: course, isLoading, isError } = useCourseQuery(slug ?? '')
  const enrollmentsQuery = useMyEnrollmentsQuery()
  const cartIds = useCart((s) => s.ids)
  const addToCart = useCart((s) => s.add)
  const [previewLesson, setPreviewLesson] = useState<Lesson | null>(null)

  if (isLoading) {
    return <div className="mx-auto max-w-3xl px-4 py-24 text-center text-muted">Carregando…</div>
  }

  if (isError || !course) {
    const suspenso = suspendedCopy(tenant)
    return (
      <div className="mx-auto max-w-3xl px-4 py-24 text-center sm:px-6">
        <h1 className="text-2xl font-bold text-ink">{suspenso ? suspenso.courseTitle : 'Curso não encontrado'}</h1>
        <p className="mt-2 text-muted">{suspenso ? suspenso.courseText : 'O curso que você procura não existe ou saiu do ar.'}</p>
        <Link to="/#cursos" className="mt-6 inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-dark">
          <ArrowLeft className="size-4" aria-hidden="true" /> Voltar para os cursos
        </Link>
      </div>
    )
  }

  const enrolled = enrollmentsQuery.data?.some((e) => e.courseId === course.id && e.status === 'active')
  const inCart = cartIds.includes(course.id)
  const preSale = preSaleDate(course.availableAt)
  const promoEnds = preSaleDate(course.promoEndsAt)

  function buyNow() {
    addToCart(course!.id)
    navigate('/carrinho')
  }

  return (
    <article className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <Link to="/#cursos" className="inline-flex items-center gap-2 text-sm font-medium text-accent transition-colors hover:text-brand-bright">
        <ArrowLeft className="size-4" aria-hidden="true" /> Voltar para os cursos
      </Link>

      <div className="mt-6 grid items-start gap-8 lg:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border border-border bg-brand-soft">
          {course.coverImageUrl ? (
            <img src={course.coverImageUrl} alt={course.title} style={{ objectPosition: course.coverFocus ?? '50% 100%' }} className="aspect-[16/10] w-full object-cover" />
          ) : (
            <div className="aspect-[16/10] w-full" />
          )}
        </div>

        <div className="flex flex-col">
          {course.category && (
            <span className="text-sm font-bold tracking-wide text-brand-bright uppercase">{course.category.name}</span>
          )}
          <h1 className="mt-2 text-3xl font-bold text-ink sm:text-4xl">{course.title}</h1>
          {course.subtitle && <p className="mt-1 text-lg text-muted">{course.subtitle}</p>}
          {course.description && <p className="mt-4 whitespace-pre-line text-muted">{course.description}</p>}

          <div className="mt-8 rounded-2xl border border-border bg-card p-5">
            <span className="block text-xs text-muted">Investimento</span>
            {course.listPriceInCents != null ? (
              <div className="mb-4">
                <span className="inline-flex items-center gap-2">
                  <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">PROMOÇÃO</span>
                  <span className="text-sm text-muted line-through">{formatPriceBRL(course.listPriceInCents)}</span>
                </span>
                <span className="block text-3xl font-bold text-accent">{formatPriceBRL(course.priceInCents)}</span>
                {promoEnds && <span className="text-xs font-bold text-red-500">Oferta termina em {promoEnds}</span>}
              </div>
            ) : (
              <span className="mb-4 block text-3xl font-bold text-accent">{formatPriceBRL(course.priceInCents)}</span>
            )}

            {preSale && (
              <p className="mb-4 flex items-start gap-2 rounded-lg bg-brand-soft px-3 py-2 text-sm font-medium text-brand">
                <CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>{preSaleLead(tenant.salesEnabled)}<strong>{preSale}</strong>.</span>
              </p>
            )}

            {enrolled ? (
              <Link to={`/aprender/${course.slug}`} className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-brand px-6 py-3 font-bold text-white shadow-lg transition-colors hover:bg-brand-dark">
                <Check className="size-5" aria-hidden="true" /> Acessar curso
              </Link>
            ) : course.kind === 'external' && course.externalUrl ? (
              <a href={course.externalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-brand px-6 py-3 font-bold text-white shadow-lg transition-colors hover:bg-brand-dark">
                Quero me inscrever <ArrowUpRight className="size-5" aria-hidden="true" />
              </a>
            ) : !tenant.salesEnabled ? (
              <EnrollViaPoloButton courseTitle={course.title} />
            ) : (
              <div className="flex flex-col gap-2">
                {inCart ? (
                  <Link to="/carrinho" className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-brand px-6 py-3 font-bold text-brand transition-colors hover:bg-brand-soft">
                    <Check className="size-5" aria-hidden="true" /> No carrinho — ir para o carrinho
                  </Link>
                ) : (
                  <button type="button" onClick={() => addToCart(course.id)} className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-brand px-6 py-3 font-bold text-brand transition-colors hover:bg-brand-soft">
                    <ShoppingCart className="size-5" aria-hidden="true" /> Adicionar ao carrinho
                  </button>
                )}
                <button type="button" onClick={buyNow} className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-brand px-6 py-3 font-bold text-white shadow-lg transition-colors hover:bg-brand-dark">
                  Comprar agora
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {course.kind === 'online' && course.modules.length > 0 && (
        <section className="mt-12">
          <h2 className="text-2xl font-bold text-ink">Conteúdo do curso</h2>
          <div className="mt-4 flex flex-col gap-4">
            {course.modules.map((module) => (
              <div key={module.id} className="rounded-2xl border border-border bg-card p-5">
                <h3 className="font-bold text-ink">{module.title}</h3>
                <ul className="mt-3 flex flex-col gap-1">
                  {module.lessons.map((lesson) =>
                    lesson.isFreePreview ? (
                      <li key={lesson.id}>
                        <button
                          type="button"
                          onClick={() => setPreviewLesson(lesson)}
                          className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-brand-soft"
                        >
                          <PlayCircle className="size-4 shrink-0 text-accent" aria-hidden="true" />
                          <span className="text-ink group-hover:text-brand">{lesson.title}</span>
                          <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-bold text-brand group-hover:bg-white">
                            Prévia grátis
                          </span>
                          <span className="ml-auto text-xs font-bold text-brand opacity-0 transition-opacity group-hover:opacity-100">
                            Assistir →
                          </span>
                        </button>
                      </li>
                    ) : (
                      <li key={lesson.id} className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted">
                        <Lock className="size-4 shrink-0 text-muted" aria-hidden="true" />
                        <span>{lesson.title}</span>
                      </li>
                    )
                  )}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {course.instructor && (course.instructor.name || course.instructor.headline || course.instructor.bio) && (
        <section className="mt-12">
          <h2 className="text-2xl font-bold text-ink">Instrutor</h2>
          <div className="mt-4 flex flex-col gap-5 rounded-2xl border border-border bg-card p-6 sm:flex-row sm:items-start">
            {course.instructor.photoUrl ? (
              <img src={course.instructor.photoUrl} alt={course.instructor.name ?? 'Instrutor'} className="size-28 shrink-0 rounded-full object-cover" />
            ) : (
              <UserCircle className="size-28 shrink-0 text-muted" aria-hidden="true" />
            )}
            <div>
              <h3 className="text-xl font-bold text-ink">{course.instructor.name ?? 'Instrutor'}</h3>
              {course.instructor.headline && <p className="mt-0.5 font-medium text-brand-bright">{course.instructor.headline}</p>}
              {course.instructor.bio && <p className="mt-3 whitespace-pre-wrap text-muted">{course.instructor.bio}</p>}
            </div>
          </div>
        </section>
      )}

      {previewLesson && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 outline-none"
          role="dialog"
          aria-modal="true"
          aria-label={`Prévia: ${previewLesson.title}`}
          tabIndex={-1}
          ref={(n) => n?.focus()}
          onKeyDown={(e) => e.key === 'Escape' && setPreviewLesson(null)}
          onClick={() => setPreviewLesson(null)}
        >
          <div
            className="w-full max-w-3xl overflow-hidden rounded-2xl bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-3">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-bold text-brand">Prévia grátis</span>
                <h3 className="font-bold text-ink">{previewLesson.title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setPreviewLesson(null)}
                aria-label="Fechar prévia"
                className="rounded-full p-1.5 text-muted transition-colors hover:bg-brand-soft hover:text-brand"
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>

            {previewLesson.videoUrl ? (
              <video src={previewLesson.videoUrl} controls autoPlay className="aspect-video w-full bg-black" />
            ) : (
              <div className="grid aspect-video w-full place-items-center bg-brand-soft px-6 text-center text-muted">
                <div>
                  <PlayCircle className="mx-auto size-10 text-brand/40" aria-hidden="true" />
                  <p className="mt-2 font-medium text-ink">Prévia em breve</p>
                  <p className="mt-1 text-sm">O vídeo desta aula ainda não foi publicado.</p>
                </div>
              </div>
            )}

            {previewLesson.description && (
              <p className="whitespace-pre-line px-5 py-4 text-sm text-muted">{previewLesson.description}</p>
            )}
          </div>
        </div>
      )}
    </article>
  )
}
