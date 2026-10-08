import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { Role, type AdminCourseRow, type AuthUser, type CourseStatus } from '@pilari/types'
import { formatPriceBRL } from '@/entities/course'
import { useMeQuery } from '@/entities/auth'
import { useTenant } from '@/entities/tenant'
import { TakedownButton } from '@/entities/platform'
import { adminCourseActions, canDeleteCourse, canTakedownCourse, deleteCourse, setCourseStatus, useCreateCourseMutation } from '@/entities/authoring'
import { useAdminUsersQuery } from '@/entities/admin-user'
import { REDE_HABILITADA } from '@/shared/config'
import { ADMIN_COURSES_KEY, ownerSelect, useAdminCoursesQuery, useSetCommissionMutation, useSetOwnerMutation } from '@/entities/admin-dashboard'

const STATUS_LABEL: Record<CourseStatus, string> = { draft: 'Rascunho', in_review: 'Em revisão', published: 'Publicado', archived: 'Arquivado' }

function apiMessage(error: unknown, fallback: string): string {
  const msg = (error as { response?: { data?: { message?: string | string[] } } } | null)?.response?.data?.message
  if (Array.isArray(msg)) return msg.join(' ')
  return msg ?? fallback
}

interface RowContext {
  isPlatformAdmin: boolean
  isMatriz: boolean
}

function CourseRow({ c, owners, ctx, refetch }: { c: AdminCourseRow; owners: AuthUser[]; ctx: RowContext; refetch: () => void }) {
  const commissionMutation = useSetCommissionMutation()
  const ownerMutation = useSetOwnerMutation()
  const statusMutation = useMutation({
    mutationFn: (status: CourseStatus) => setCourseStatus(c.id, status),
    onSuccess: () => refetch(),
  })
  const qc = useQueryClient()
  const [commission, setCommission] = useState(String(c.commissionPercent))
  const [confirming, setConfirming] = useState(false)
  const deleteMutation = useMutation({
    mutationFn: () => deleteCourse(c.id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ADMIN_COURSES_KEY }); refetch() },
    // O servidor recusa a exclusão de curso com histórico (409): a mensagem dele fica na linha e o botão
    // vermelho sai, para não convidar a repetir um pedido que será recusado de novo.
    onError: () => setConfirming(false),
  })

  // A tela é só de admin (do polo ou da plataforma): o que muda de um para o outro é quem aprova e quem exclui.
  const acoes = adminCourseActions({
    status: c.status, approvedAt: c.approvedAt, reviewNote: c.reviewNote,
    isTenantAdmin: true, isPlatformAdmin: ctx.isPlatformAdmin, isMatriz: ctx.isMatriz,
  })
  const podeExcluir = canDeleteCourse({ approvedAt: c.approvedAt, isPlatformAdmin: ctx.isPlatformAdmin })
  // Em análise e sem o botão de aprovar: quem decide é o Studio Pilari (vale para o polo, não para a plataforma nem a matriz).
  const aguardaPlataforma = c.status === 'in_review' && !acoes.some((a) => a.to === 'published')
  const dono = ownerSelect(c, owners.map((t) => t.uid))

  return (
    <tr className="border-b border-border">
      <td className="py-2 pr-3">
        <Link to={`/instrutor/curso/${c.id}`} className="font-medium text-accent hover:text-brand-bright">{c.title}</Link>
      </td>
      {REDE_HABILITADA && <td className="px-3">
        <select
          value={dono.value}
          onChange={(e) => e.target.value && ownerMutation.mutate({ courseId: c.id, instructorId: e.target.value })}
          disabled={ownerMutation.isPending}
          className="max-w-[12rem] rounded border border-border bg-bg px-1 py-0.5 text-sm text-foreground"
        >
          <option value="">{dono.emptyLabel}</option>
          {owners.map((t) => <option key={t.uid} value={t.uid}>{t.displayName ?? t.email}</option>)}
        </select>
        {ownerMutation.isError && <span role="alert" className="block max-w-[12rem] text-xs text-red-500">{apiMessage(ownerMutation.error, 'erro ao vincular')}</span>}
      </td>}
      <td className="px-3">
        <span className={c.status === 'in_review' ? 'rounded-full bg-brand/15 px-2 py-0.5 text-xs font-bold text-brand' : ''}>
          {STATUS_LABEL[c.status] ?? c.status}
        </span>
        {/* A nota do Studio Pilari explica por que não há "Publicar" (o polo corrige e envia para análise de novo). O texto
            inteiro fica no title; a linha mostra só o começo. */}
        {c.reviewNote && (
          <div title={c.reviewNote} className="mt-1 max-w-[14rem] rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
            <p className="font-bold">Ajustes pedidos pelo Studio Pilari</p>
            <p className="line-clamp-2 break-words">{c.reviewNote}</p>
          </div>
        )}
      </td>
      <td className="px-3">{formatPriceBRL(c.priceInCents)}</td>
      {REDE_HABILITADA && <td className="px-3">
        <div className="flex items-center gap-1">
          <input value={commission} onChange={(e) => setCommission(e.target.value)} className="w-14 rounded border border-border bg-bg px-1 py-0.5 text-sm" />%
          <button type="button" onClick={() => commissionMutation.mutate({ courseId: c.id, commissionPercent: Number(commission) || 0 })} className="text-xs text-accent hover:underline">salvar</button>
        </div>
      </td>}
      <td className="px-3">
        <div className="flex items-center gap-2">
          {acoes.map((a) => (
            <button
              key={a.to}
              type="button"
              onClick={() => statusMutation.mutate(a.to)}
              disabled={statusMutation.isPending}
              className={
                a.primary
                  ? 'rounded-full border border-brand px-3 py-1 text-xs font-bold text-brand hover:bg-brand-soft disabled:opacity-60'
                  : 'rounded-full border border-border px-3 py-1 text-xs font-bold text-muted hover:text-ink disabled:opacity-60'
              }
            >
              {a.label}
            </button>
          ))}
          {canTakedownCourse({ status: c.status, isPlatformAdmin: ctx.isPlatformAdmin, isMatriz: ctx.isMatriz }) && <TakedownButton courseId={c.id} onDone={refetch} />}
          {acoes.length === 0 && c.status !== 'in_review' && (
            <span className="text-xs text-muted">Envie para análise pelo editor</span>
          )}
          {aguardaPlataforma && <span className="text-xs text-muted">Aguardando o Studio Pilari</span>}
          {podeExcluir && (confirming ? (
            <span className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="rounded-full bg-red-500 px-3 py-1 text-xs font-bold text-white hover:bg-red-600 disabled:opacity-60"
              >
                {deleteMutation.isPending ? 'Excluindo…' : 'Confirmar exclusão'}
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="text-xs text-muted hover:text-ink">cancelar</button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-full p-1.5 text-muted hover:bg-red-500/10 hover:text-red-500"
              title="Excluir curso"
              aria-label="Excluir curso"
            >
              <Trash2 className="size-4" />
            </button>
          ))}
        </div>
        {deleteMutation.isError && <span className="mt-1 block max-w-xs text-xs text-red-500">{apiMessage(deleteMutation.error, 'erro ao excluir')}</span>}
        {statusMutation.isError && <span className="mt-1 block max-w-xs text-xs text-red-500">{apiMessage(statusMutation.error, 'erro ao mudar o status')}</span>}
      </td>
    </tr>
  )
}

export function AdminCourses() {
  const { data, isLoading, isError, refetch } = useAdminCoursesQuery()
  const usersQuery = useAdminUsersQuery()
  // Dono do curso: professor ou admin do polo (o servidor aceita os dois).
  const owners = usersQuery.data?.filter((u) => u.roles.includes(Role.teacher) || u.roles.includes(Role.admin)) ?? []
  const { data: me } = useMeQuery()
  const tenant = useTenant()
  const ctx: RowContext = { isPlatformAdmin: me?.user?.isPlatformAdmin ?? false, isMatriz: tenant.isMatriz }
  const createMutation = useCreateCourseMutation()
  const navigate = useNavigate()
  const qc = useQueryClient()

  function criarCurso() {
    createMutation.mutate(
      { title: 'Novo curso' },
      {
        onSuccess: (c) => {
          void qc.invalidateQueries({ queryKey: ADMIN_COURSES_KEY })
          navigate(`/instrutor/curso/${c.id}`)
        },
      }
    )
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-ink">Cursos</h2>
          <p className="mt-1 text-sm text-muted">
            {REDE_HABILITADA
              ? 'Vincule um parceiro a cada curso. As vendas seguintes geram repasse para ele.'
              : 'Crie, publique e organize os cursos do Studio Pilari.'}
          </p>
        </div>
        <button
          type="button"
          onClick={criarCurso}
          disabled={createMutation.isPending}
          className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 font-bold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
        >
          <Plus className="size-5" aria-hidden="true" /> {createMutation.isPending ? 'Criando…' : 'Criar curso'}
        </button>
      </div>
      {createMutation.isError && <p className="mt-3 text-sm text-red-500">Não foi possível criar o curso. Tente novamente.</p>}
      {isLoading && <p className="mt-4 text-muted">Carregando…</p>}
      {isError && <p className="mt-4 text-red-500">Não foi possível carregar os cursos.</p>}
      {data && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm text-ink">
            <thead className="text-xs text-muted">
              <tr className="border-b border-border">
                <th className="py-2 pr-3 font-medium">Curso</th>
                {REDE_HABILITADA && <th className="px-3 font-medium">Parceiro</th>}
                <th className="px-3 font-medium">Status</th>
                <th className="px-3 font-medium">Preço</th>
                {REDE_HABILITADA && <th className="px-3 font-medium">Comissão</th>}
                <th className="px-3 font-medium">Ação</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => <CourseRow key={c.id} c={c} owners={owners} ctx={ctx} refetch={() => void refetch()} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
