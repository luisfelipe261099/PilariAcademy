import { useState } from 'react'
import { Clock, Plus, Trash2 } from 'lucide-react'
import { useCreateNoteMutation, useDeleteNoteMutation, useNotesQuery } from '@/entities/note'

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function NotesTab({ slug, lessonId, getTime, onSeek }: {
  slug: string
  lessonId: string | null
  getTime: () => number
  onSeek: (sec: number) => void
}) {
  const q = useNotesQuery(slug)
  const create = useCreateNoteMutation(slug)
  const del = useDeleteNoteMutation(slug)
  const [body, setBody] = useState('')

  function add() {
    const text = body.trim()
    if (!text || !lessonId) return
    create.mutate({ lessonId, atSec: Math.round(getTime()), body: text }, { onSuccess: () => setBody('') })
  }

  const notes = q.data ?? []

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-border bg-bg p-4">
        <p className="text-sm text-muted">A observação é ancorada no momento atual do vídeo {lessonId ? <strong className="text-ink">({fmtTime(Math.round(getTime()))})</strong> : ''}.</p>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder="Escreva uma anotação…"
          className="mt-2 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
        />
        <button
          type="button"
          disabled={!body.trim() || !lessonId || create.isPending}
          onClick={add}
          className="mt-2 inline-flex items-center gap-1 rounded-full bg-brand px-4 py-1.5 text-sm font-bold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          <Plus className="size-4" aria-hidden="true" /> {create.isPending ? 'Salvando…' : 'Adicionar observação'}
        </button>
      </div>

      {q.isLoading && <p className="text-muted">Carregando…</p>}
      {q.isError && <p className="text-muted">Observações indisponíveis no momento.</p>}

      <ul className="flex flex-col gap-2">
        {notes.map((n) => (
          <li key={n.id} className="rounded-xl border border-border bg-card p-3">
            <div className="flex items-start justify-between gap-2">
              <button type="button" onClick={() => onSeek(n.atSec)} className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-bold text-brand hover:bg-brand/20">
                <Clock className="size-3" aria-hidden="true" /> {fmtTime(n.atSec)}
              </button>
              <button type="button" onClick={() => del.mutate(n.id)} className="text-muted hover:text-red-500" aria-label="Excluir observação">
                <Trash2 className="size-4" />
              </button>
            </div>
            {n.lessonTitle && <p className="mt-1 text-xs text-muted">{n.lessonTitle}</p>}
            <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{n.body}</p>
          </li>
        ))}
        {!q.isLoading && notes.length === 0 && <li className="text-sm text-muted">Você ainda não tem observações neste curso.</li>}
      </ul>
    </div>
  )
}
