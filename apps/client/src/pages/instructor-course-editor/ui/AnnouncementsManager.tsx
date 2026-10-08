import { useState } from 'react'
import { Megaphone, Plus, Trash2 } from 'lucide-react'
import { useCreateAnnouncementMutation, useDeleteAnnouncementMutation, useInstructorAnnouncementsQuery } from '@/entities/announcement'

function fmtDate(iso: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function AnnouncementsManager({ courseId }: { courseId: string }) {
  const q = useInstructorAnnouncementsQuery(courseId)
  const create = useCreateAnnouncementMutation(courseId)
  const del = useDeleteAnnouncementMutation(courseId)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  function publish() {
    if (!title.trim() || !body.trim()) return
    create.mutate({ title: title.trim(), body: body.trim() }, { onSuccess: () => { setTitle(''); setBody('') } })
  }

  const items = q.data ?? []

  return (
    <section className="mt-8">
      <h2 className="flex items-center gap-2 text-xl font-bold text-ink">
        <Megaphone className="size-5 text-brand" aria-hidden="true" /> Anúncios para a turma
      </h2>
      <p className="mt-1 text-sm text-muted">Avisos que aparecem para todos os alunos matriculados, na aba "Anúncios" da sala de aula.</p>

      <div className="mt-4 grid gap-3 rounded-2xl border border-border bg-card p-4">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título do anúncio" className="rounded-lg border border-border bg-bg px-3 py-2 text-foreground" />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Conteúdo do anúncio" className="rounded-lg border border-border bg-bg px-3 py-2 text-foreground" />
        <button type="button" disabled={!title.trim() || !body.trim() || create.isPending} onClick={publish} className="inline-flex items-center gap-2 self-start rounded-full bg-brand px-5 py-2 font-bold text-white hover:bg-brand-dark disabled:opacity-60">
          <Plus className="size-5" aria-hidden="true" /> {create.isPending ? 'Publicando…' : 'Publicar anúncio'}
        </button>
        {create.isError && <p className="text-sm text-red-500">Não foi possível publicar.</p>}
      </div>

      {q.isError && <p className="mt-3 text-sm text-muted">Anúncios indisponíveis no momento.</p>}
      <ul className="mt-4 flex flex-col gap-2">
        {items.map((a) => (
          <li key={a.id} className="rounded-xl border border-border bg-bg p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-bold text-ink">{a.title}</p>
                <p className="text-xs text-muted">{fmtDate(a.createdAt)}</p>
              </div>
              <button type="button" onClick={() => del.mutate(a.id)} className="text-muted hover:text-red-500" aria-label="Excluir anúncio">
                <Trash2 className="size-4" />
              </button>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{a.body}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
