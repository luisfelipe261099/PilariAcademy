import { useState, type ReactNode } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import type { ReviewQueueItem } from '@pilari/types'
import { FIRST_APPROVAL_WARNING, courseChangedNotice, useReviewMutations, useReviewQueueQuery, workloadLabel } from '@/entities/platform'

function apiMessage(error: unknown, fallback: string): string {
  const msg = (error as { response?: { data?: { message?: string | string[] } } } | null)?.response?.data?.message
  if (Array.isArray(msg)) return msg.join(' ')
  return msg ?? fallback
}

const naoInformado = <span className="font-normal text-muted">não informado</span>

function Dado({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{rotulo}</dt>
      <dd className="text-sm font-medium text-ink">{children}</dd>
    </div>
  )
}

function ItemDaFila({ item }: { item: ReviewQueueItem }) {
  const { approve, giveBack } = useReviewMutations()
  const [devolvendo, setDevolvendo] = useState(false)
  const [nota, setNota] = useState('')
  // Cada modo mostra o erro da própria ação: o de uma aprovação recusada não fica grudado na devolução, e vice-versa.
  const erro = devolvendo ? giveBack.error : approve.error
  return (
    <li className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-lg font-bold text-ink">{item.title}</p>
          <p className="text-sm text-muted">
            {item.tenantName} · {item.instructorName ?? 'sem instrutor'} · enviado em {item.submittedAt ? new Date(item.submittedAt).toLocaleString('pt-BR') : '—'}
          </p>
          <p className="mt-1 text-sm text-muted">{item.moduleCount} módulo(s), {item.lessonCount} aula(s)</p>
        </div>
        <a href={item.editorUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
          Abrir no site do polo <ExternalLink className="size-4" aria-hidden="true" />
        </a>
      </div>

      {/* O que o certificado vai levar. É a versão que a aprovação confirma (fingerprint): se o polo mexer, o servidor recusa. */}
      <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
        <Dado rotulo="Carga horária">{workloadLabel(item)}</Dado>
        <Dado rotulo="Coordenador">{item.coordinatorName ?? naoInformado}</Dado>
        <Dado rotulo="Cargo do coordenador">{item.coordinatorRole ?? naoInformado}</Dado>
        <Dado rotulo="Assinatura do coordenador">{item.hasCoordinatorSignature ? 'Anexada' : <span className="font-normal text-muted">sem assinatura</span>}</Dado>
      </dl>

      {item.reviewNote && (
        <div className="mt-3 rounded-xl border border-border bg-bg px-4 py-3 text-sm">
          <p className="font-bold text-ink">Nota do Studio Pilari (devolução ou retirada anterior)</p>
          <p className="mt-1 whitespace-pre-line text-muted">{item.reviewNote}</p>
        </div>
      )}
      {item.firstApproval && (
        <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">{FIRST_APPROVAL_WARNING}</p>
      )}

      {devolvendo ? (
        <div className="mt-3 grid gap-2">
          <textarea
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            rows={3}
            maxLength={1000}
            aria-label="O que o polo precisa ajustar"
            placeholder="O que o polo precisa ajustar"
            className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-foreground"
          />
          <div className="flex gap-2">
            <button type="button" disabled={giveBack.isPending || nota.trim().length < 3} onClick={() => giveBack.mutate({ courseId: item.courseId, note: nota.trim() })} className="rounded-full bg-brand px-4 py-1.5 text-sm font-bold text-white disabled:opacity-60">
              Devolver com este motivo
            </button>
            <button type="button" onClick={() => { giveBack.reset(); setDevolvendo(false) }} className="text-sm text-muted">cancelar</button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={approve.isPending} onClick={() => approve.mutate({ courseId: item.courseId, fingerprint: item.fingerprint })} className="rounded-full bg-brand px-4 py-1.5 text-sm font-bold text-white disabled:opacity-60">
            {approve.isPending ? 'Aprovando…' : 'Aprovar e publicar'}
          </button>
          <button type="button" disabled={approve.isPending} onClick={() => { approve.reset(); setDevolvendo(true) }} className="rounded-full border border-border px-4 py-1.5 text-sm font-bold text-ink hover:bg-brand-soft disabled:opacity-60">
            Devolver para ajustes
          </button>
        </div>
      )}
      {/* No 409 a fila já recarregou sozinha: o aviso manda conferir os dados novos, no lugar do "Recarregue" do servidor. */}
      {erro && <p role="alert" className="mt-2 text-sm text-red-500">{courseChangedNotice(erro) ?? apiMessage(erro, 'Não foi possível concluir.')}</p>}
    </li>
  )
}

export function PlatformReview() {
  const fila = useReviewQueueQuery()
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-ink">Aprovação de cursos</h2>
          <p className="mt-1 text-sm text-muted">
            Cursos que os polos enviaram para análise. Depois da primeira aprovação, título, carga horária, coordenador e assinatura só mudam pelo Studio Pilari.
          </p>
        </div>
        <button type="button" onClick={() => void fila.refetch()} disabled={fila.isFetching} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-1.5 text-sm font-bold text-ink hover:bg-brand-soft disabled:opacity-60">
          <RefreshCw className={'size-4' + (fila.isFetching ? ' animate-spin' : '')} aria-hidden="true" /> Atualizar
        </button>
      </div>
      {fila.isLoading && <p className="mt-4 text-muted">Carregando…</p>}
      {fila.isError && <p role="alert" className="mt-4 text-red-500">{apiMessage(fila.error, 'Não foi possível carregar a fila.')}</p>}
      {fila.data && fila.data.length === 0 && <p className="mt-4 text-muted">Nenhum curso aguardando análise.</p>}
      {fila.data && fila.data.length > 0 && (
        <ul className="mt-4 grid gap-3">
          {fila.data.map((item) => <ItemDaFila key={item.courseId} item={item} />)}
        </ul>
      )}
    </div>
  )
}
