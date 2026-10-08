import { useState } from 'react'
import { Star } from 'lucide-react'
import type { CourseReview } from '@pilari/types'
import { useCourseReviewsQuery, useUpsertReviewMutation } from '@/entities/review'

function Stars({ value, onSelect, size = 'size-5' }: { value: number; onSelect?: (n: number) => void; size?: string }) {
  return (
    <span className="inline-flex">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= Math.round(value)
        const cls = `${size} ${filled ? 'fill-yellow-400 text-yellow-400' : 'text-muted'}`
        return onSelect ? (
          <button key={n} type="button" onClick={() => onSelect(n)} aria-label={`${n} estrela${n > 1 ? 's' : ''}`}>
            <Star className={cls} />
          </button>
        ) : (
          <Star key={n} className={cls} aria-hidden="true" />
        )
      })}
    </span>
  )
}

function MyReviewForm({ slug, mine }: { slug: string; mine: CourseReview | null }) {
  const [rating, setRating] = useState(mine?.rating ?? 0)
  const [comment, setComment] = useState(mine?.comment ?? '')
  const upsert = useUpsertReviewMutation(slug)

  return (
    <div className="rounded-2xl border border-border bg-bg p-4">
      <h3 className="font-bold text-ink">{mine ? 'Sua avaliação' : 'Avalie este curso'}</h3>
      <div className="mt-2"><Stars value={rating} onSelect={setRating} /></div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={3}
        placeholder="Conte o que achou do curso (opcional)"
        className="mt-3 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          disabled={rating < 1 || upsert.isPending}
          onClick={() => upsert.mutate({ rating, comment: comment.trim() || null })}
          className="rounded-full bg-brand px-5 py-2 text-sm font-bold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {upsert.isPending ? 'Enviando…' : mine ? 'Atualizar avaliação' : 'Enviar avaliação'}
        </button>
        {upsert.isError && <span className="text-sm text-red-500">Não foi possível salvar.</span>}
        {upsert.isSuccess && <span className="text-sm text-accent">Avaliação salva!</span>}
      </div>
    </div>
  )
}

export function ReviewsTab({ slug }: { slug: string }) {
  const q = useCourseReviewsQuery(slug)

  if (q.isLoading) return <p className="text-muted">Carregando avaliações…</p>
  if (q.isError || !q.data) return <p className="text-muted">Avaliações indisponíveis no momento.</p>
  const data = q.data

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="text-3xl font-bold text-ink">{data.average.toFixed(1)}</span>
        <span>
          <Stars value={data.average} />
          <span className="block text-sm text-muted">{data.count} {data.count === 1 ? 'avaliação' : 'avaliações'}</span>
        </span>
      </div>

      <MyReviewForm key={data.mine?.id ?? 'new'} slug={slug} mine={data.mine} />

      <ul className="flex flex-col gap-3">
        {data.reviews.map((r) => (
          <li key={r.id} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-ink">{r.userName ?? 'Aluno'}</span>
              <Stars value={r.rating} size="size-4" />
            </div>
            {r.comment && <p className="mt-1 text-sm text-muted">{r.comment}</p>}
          </li>
        ))}
        {data.reviews.length === 0 && <li className="text-sm text-muted">Seja o primeiro a avaliar este curso.</li>}
      </ul>
    </div>
  )
}
