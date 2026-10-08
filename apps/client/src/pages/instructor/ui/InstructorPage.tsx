import { Link, useNavigate } from 'react-router-dom'
import { MessageCircle, Plus, UserCircle } from 'lucide-react'
import type { CourseStatus } from '@pilari/types'
import { useInstructorCoursesQuery, useCreateCourseMutation } from '@/entities/authoring'
import { courseCoverSrc } from '@/entities/course'
import { GanhosInstrutor } from '@/entities/finance'

const STATUS_LABEL: Record<CourseStatus, string> = { draft: 'Rascunho', in_review: 'Em análise', published: 'Publicado', archived: 'Arquivado' }

export function InstructorPage() {
  const { data, isLoading, isError } = useInstructorCoursesQuery()
  const createMutation = useCreateCourseMutation()
  const navigate = useNavigate()

  function novoCurso() {
    createMutation.mutate({ title: 'Novo curso' }, { onSuccess: (c) => navigate(`/instrutor/curso/${c.id}`) })
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold text-ink">Meus cursos (instrutor)</h1>
        <div className="flex items-center gap-3">
          <Link
            to="/instrutor/perfil"
            className="inline-flex items-center gap-2 rounded-full border border-brand px-5 py-2.5 font-bold text-brand transition-colors hover:bg-brand-soft"
          >
            <UserCircle className="size-5" aria-hidden="true" /> Meu perfil
          </Link>
          <Link
            to="/instrutor/mensagens"
            className="inline-flex items-center gap-2 rounded-full border border-brand px-5 py-2.5 font-bold text-brand transition-colors hover:bg-brand-soft"
          >
            <MessageCircle className="size-5" aria-hidden="true" /> Mensagens
          </Link>
          <button
            type="button"
            onClick={novoCurso}
            disabled={createMutation.isPending}
            className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 font-bold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
          >
            <Plus className="size-5" aria-hidden="true" /> {createMutation.isPending ? 'Criando…' : 'Novo curso'}
          </button>
        </div>
      </div>

      {isLoading && <p className="mt-8 text-muted">Carregando…</p>}
      {isError && <p className="mt-8 text-red-500">Não foi possível carregar seus cursos.</p>}

      {data && data.length === 0 && (
        <p className="mt-8 text-muted">Você ainda não criou cursos. Clique em "Novo curso" para começar.</p>
      )}

      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {data?.map((c) => {
          const coverSrc = courseCoverSrc(c.id, c.coverImageUrl)
          return (
          <Link
            key={c.id}
            to={`/instrutor/curso/${c.id}`}
            className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-colors hover:border-brand/40"
          >
            <div className="aspect-[16/10] bg-brand-soft">
              {coverSrc && <img src={coverSrc} alt={c.title} style={{ objectPosition: c.coverFocus ?? '50% 100%' }} className="size-full object-cover" />}
            </div>
            <div className="flex flex-1 flex-col p-4">
              <span className="text-xs font-bold uppercase text-brand-bright">{STATUS_LABEL[c.status] ?? c.status}</span>
              <h3 className="mt-1 line-clamp-2 font-bold text-ink">{c.title}</h3>
              <span className="mt-auto text-xs text-muted">{c.moduleCount} módulos · {c.lessonCount} aulas</span>
            </div>
          </Link>
          )
        })}
      </div>

      <GanhosInstrutor />
    </div>
  )
}
