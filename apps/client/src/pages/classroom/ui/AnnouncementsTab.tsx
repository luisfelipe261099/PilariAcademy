import { Megaphone } from 'lucide-react'
import { useStudentAnnouncementsQuery } from '@/entities/announcement'

function fmtDate(iso: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}

export function AnnouncementsTab({ slug }: { slug: string }) {
  const q = useStudentAnnouncementsQuery(slug)

  if (q.isLoading) return <p className="text-muted">Carregando anúncios…</p>
  if (q.isError) return <p className="text-muted">Anúncios indisponíveis no momento.</p>
  const items = q.data ?? []

  if (items.length === 0) return <p className="text-muted">Nenhum anúncio do instrutor por enquanto.</p>

  return (
    <ul className="flex flex-col gap-3">
      {items.map((a) => (
        <li key={a.id} className="rounded-2xl border border-border bg-card p-4">
          <h3 className="flex items-center gap-2 font-bold text-ink">
            <Megaphone className="size-4 text-brand" aria-hidden="true" /> {a.title}
          </h3>
          <p className="mt-0.5 text-xs text-muted">{a.authorName ?? 'Instrutor'} · {fmtDate(a.createdAt)}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{a.body}</p>
        </li>
      ))}
    </ul>
  )
}
