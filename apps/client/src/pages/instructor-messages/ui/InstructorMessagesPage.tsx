import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, MessageCircle } from 'lucide-react'
import { ChatThread, useConversationsQuery, useInstructorThreadQuery, useSendInstructorMessageMutation } from '@/entities/message'

type Selected = { courseId: string; studentId: string; studentName: string | null }

function Thread({ sel }: { sel: Selected }) {
  const threadQuery = useInstructorThreadQuery(sel.courseId, sel.studentId)
  const sendMut = useSendInstructorMessageMutation(sel.courseId, sel.studentId)
  const messages = threadQuery.data?.messages ?? []

  return (
    <div className="rounded-2xl border border-border bg-bg p-4">
      <h2 className="font-bold text-ink">{sel.studentName ?? 'Aluno'}</h2>
      <p className="mb-3 text-xs text-muted">{threadQuery.data?.courseTitle ?? ''}</p>
      <ChatThread
        messages={messages}
        viewerIsStudent={false}
        onSend={(b) => sendMut.mutate(b)}
        sending={sendMut.isPending}
        emptyHint="Sem mensagens nesta conversa ainda."
      />
      {sendMut.isError && <p className="mt-2 text-sm text-red-500">Não foi possível enviar. Tente novamente.</p>}
    </div>
  )
}

export function InstructorMessagesPage() {
  const convosQuery = useConversationsQuery()
  const convos = convosQuery.data ?? []
  const [sel, setSel] = useState<Selected | null>(null)

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <Link to="/instrutor" className="inline-flex items-center gap-2 text-sm font-medium text-accent hover:text-brand-bright">
        <ArrowLeft className="size-4" aria-hidden="true" /> Meus cursos
      </Link>
      <h1 className="mt-3 flex items-center gap-2 text-2xl font-bold text-ink">
        <MessageCircle className="size-6 text-brand" aria-hidden="true" /> Mensagens dos alunos
      </h1>

      {convosQuery.isLoading && <p className="mt-6 text-muted">Carregando…</p>}
      {convosQuery.isError && <p className="mt-6 text-red-500">Não foi possível carregar as conversas.</p>}
      {convosQuery.data && convos.length === 0 && <p className="mt-6 text-muted">Nenhuma conversa ainda. Quando um aluno enviar uma mensagem, ela aparece aqui.</p>}

      {convos.length > 0 && (
        <div className="mt-6 grid gap-6 md:grid-cols-[320px_1fr]">
          <ul className="flex flex-col gap-2">
            {convos.map((c) => {
              const active = sel?.courseId === c.courseId && sel?.studentId === c.studentId
              return (
                <li key={`${c.courseId}:${c.studentId}`}>
                  <button
                    type="button"
                    onClick={() => setSel({ courseId: c.courseId, studentId: c.studentId, studentName: c.studentName })}
                    className={'w-full rounded-xl border p-3 text-left transition-colors ' + (active ? 'border-brand bg-brand-soft' : 'border-border bg-card hover:border-brand/40')}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-ink">{c.studentName ?? 'Aluno'}</span>
                      {c.unread > 0 && <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-white">{c.unread}</span>}
                    </div>
                    <span className="block text-xs text-muted">{c.courseTitle}</span>
                    <span className="mt-1 block truncate text-sm text-muted">{c.lastBody}</span>
                  </button>
                </li>
              )
            })}
          </ul>

          {sel ? <Thread sel={sel} /> : <p className="rounded-2xl border border-dashed border-border bg-bg p-8 text-center text-muted">Selecione uma conversa para responder.</p>}
        </div>
      )}
    </div>
  )
}
