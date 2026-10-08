import { useState } from 'react'
import { BookOpen, Check, ClipboardList, Loader2, Plus, RotateCcw, Trash2, X , Award } from 'lucide-react'
import type { AuthUser } from '@pilari/types'
import { useMeQuery } from '@/entities/auth'
import { downloadPdfPost } from '@/entities/my-account'
import { useAdminCoursesQuery } from '@/entities/admin-dashboard'
import { GradesReport, useReleaseCourseQuizzesMutation, useStudentCourseGradesQuery } from '@/entities/quiz'
import {
  useGrantEnrollmentMutation,
  useRevokeEnrollmentMutation,
  useUserEnrollmentsQuery,
} from '../queries'

/** Libera +5 tentativas de prova em todo o curso para o aluno (repetente). */
function ReleaseQuizzesButton({ courseId, studentUid }: { courseId: string; studentUid: string }) {
  const release = useReleaseCourseQuizzesMutation(courseId)
  return (
    <button
      type="button"
      onClick={() => release.mutate(studentUid)}
      disabled={release.isPending || release.isSuccess}
      title="Libera +5 tentativas nas provas deste curso"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-brand/40 px-3 py-1 text-sm font-medium text-brand transition-colors hover:bg-brand-soft disabled:opacity-60"
    >
      {release.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="size-4" aria-hidden="true" />}
      {release.isSuccess ? 'Provas liberadas' : 'Liberar provas'}
    </button>
  )
}

/**
 * Emite o certificado pelo admin e baixa no mesmo clique.
 *
 * Ignora as travas de progresso e de carnê: é a instituição decidindo certificar alguém que
 * o sistema barraria — o caso real é o aluno ter concluído sem o sistema registrar. Por isso
 * confirma antes e a ação fica auditada no servidor.
 */
function EmitirCertificadoButton({ courseId, studentUid }: { courseId: string; studentUid: string }) {
  const [confirmando, setConfirmando] = useState(false)
  const [baixando, setBaixando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const emitir = async () => {
    setErro(null)
    setBaixando(true)
    try {
      await downloadPdfPost(`/admin/students/${studentUid}/courses/${courseId}/certificate`, 'certificado.pdf')
      setConfirmando(false)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao emitir.')
    } finally {
      setBaixando(false)
    }
  }

  if (confirmando) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-brand/40 px-3 py-1">
        <span className="text-xs text-brand">Emitir mesmo sem concluir?</span>
        <button
          type="button"
          disabled={baixando}
          onClick={() => void emitir()}
          className="cursor-pointer text-xs font-bold text-brand hover:underline disabled:opacity-60"
        >
          {baixando ? 'Gerando…' : 'Sim, emitir'}
        </button>
        <button
          type="button"
          onClick={() => setConfirmando(false)}
          className="cursor-pointer text-xs text-muted hover:underline"
        >
          não
        </button>
        {erro && <span className="text-xs text-red-500">{erro}</span>}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setConfirmando(true)}
      className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm font-medium text-ink transition-colors hover:bg-brand-soft"
    >
      <Award className="size-4" aria-hidden="true" /> Certificado
    </button>
  )
}

function apiMessage(error: unknown, fallback: string): string {
  const msg = (error as { response?: { data?: { message?: string | string[] } } } | null)?.response?.data?.message
  if (Array.isArray(msg)) return msg.join(' ')
  return msg ?? fallback
}

const SOURCE_LABEL: Record<string, string> = { free: 'Manual', purchase: 'Compra' }
const STATUS_LABEL: Record<string, string> = { active: 'Ativo', pending: 'Pendente', canceled: 'Cancelado' }

/** Botão + modal para o admin dar/retirar acesso a cursos de um aluno manualmente. */
export function ManageEnrollmentsButton({ user }: { user: AuthUser }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm font-medium text-ink hover:bg-brand-soft"
      >
        <BookOpen className="size-4" aria-hidden="true" /> Gerenciar cursos
      </button>
      {open && <ManageEnrollmentsModal user={user} onClose={() => setOpen(false)} />}
    </>
  )
}

interface EnrolledCourse {
  courseId: string
  courseTitle: string
  status: string
  source: string
}

/** Linha de um curso do aluno: badges, ver notas (boletim), liberar provas e remover. */
function EnrolledCourseRow({
  enrollment,
  studentUid,
  revoke,
}: {
  enrollment: EnrolledCourse
  studentUid: string
  revoke: ReturnType<typeof useRevokeEnrollmentMutation>
}) {
  const { data: me } = useMeQuery()
  const [showGrades, setShowGrades] = useState(false)
  const gradesQuery = useStudentCourseGradesQuery(enrollment.courseId, studentUid, showGrades)

  return (
    <li className="rounded-lg border border-border bg-bg p-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{enrollment.courseTitle}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-bold text-brand">
              {enrollment.status === 'active' && <Check className="size-3" aria-hidden="true" />}
              {STATUS_LABEL[enrollment.status] ?? enrollment.status}
            </span>
            <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted">
              {SOURCE_LABEL[enrollment.source] ?? enrollment.source}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setShowGrades((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm font-medium text-ink transition-colors hover:bg-brand-soft"
          >
            <ClipboardList className="size-4" aria-hidden="true" /> {showGrades ? 'Ocultar notas' : 'Ver notas'}
          </button>
          <ReleaseQuizzesButton courseId={enrollment.courseId} studentUid={studentUid} />
          {me?.user?.isPlatformAdmin && <EmitirCertificadoButton courseId={enrollment.courseId} studentUid={studentUid} />}
          <button
            type="button"
            onClick={() => revoke.mutate(enrollment.courseId)}
            disabled={revoke.isPending}
            className="inline-flex items-center gap-1.5 rounded-full border border-red-200 px-3 py-1 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60"
          >
            <Trash2 className="size-4" aria-hidden="true" /> Remover
          </button>
        </div>
      </div>

      {showGrades && (
        <div className="mt-3 border-t border-border pt-3">
          {gradesQuery.isLoading && <p className="text-sm text-muted">Carregando boletim…</p>}
          {gradesQuery.isError && <p className="text-sm text-red-500">Não foi possível carregar o boletim.</p>}
          {gradesQuery.data && <GradesReport grades={gradesQuery.data} />}
        </div>
      )}
    </li>
  )
}

function ManageEnrollmentsModal({ user, onClose }: { user: AuthUser; onClose: () => void }) {
  const enrollmentsQuery = useUserEnrollmentsQuery(user.uid)
  const coursesQuery = useAdminCoursesQuery()
  const grant = useGrantEnrollmentMutation(user.uid)
  const revoke = useRevokeEnrollmentMutation(user.uid)
  const [selected, setSelected] = useState('')

  const enrolled = enrollmentsQuery.data ?? []
  const enrolledIds = new Set(enrolled.map((e) => e.courseId))
  const available = (coursesQuery.data ?? []).filter((c) => !enrolledIds.has(c.id))

  function onAdd() {
    if (!selected) return
    grant.mutate(selected, { onSuccess: () => setSelected('') })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 outline-none"
      role="dialog"
      aria-modal="true"
      aria-label={`Cursos de ${user.displayName ?? user.email}`}
      tabIndex={-1}
      ref={(n) => n?.focus()}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate font-bold text-ink">{user.displayName ?? '—'}</h3>
            <p className="truncate text-sm text-muted">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="shrink-0 rounded-full p-1.5 text-muted transition-colors hover:bg-brand-soft hover:text-brand"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        {/* Adicionar acesso */}
        <div className="border-b border-border bg-brand-soft/40 px-5 py-4">
          <label className="mb-2 block text-sm font-bold text-ink">Liberar acesso a um curso</label>
          <div className="flex gap-2">
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-foreground"
            >
              <option value="">{available.length ? 'Selecione um curso…' : 'Nenhum curso disponível'}</option>
              {available.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onAdd}
              disabled={!selected || grant.isPending}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
            >
              {grant.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
              Liberar
            </button>
          </div>
          {grant.isError && <p className="mt-2 text-sm text-red-500">{apiMessage(grant.error, 'Não foi possível liberar o curso.')}</p>}
        </div>

        {/* Cursos atuais */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <h4 className="mb-2 text-sm font-bold text-ink">Cursos do aluno</h4>
          {enrollmentsQuery.isLoading && <p className="text-sm text-muted">Carregando…</p>}
          {!enrollmentsQuery.isLoading && enrolled.length === 0 && (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
              Este aluno ainda não tem cursos.
            </p>
          )}
          {revoke.isError && <p className="mb-2 text-sm text-red-500">{apiMessage(revoke.error, 'Não foi possível remover o acesso.')}</p>}
          <ul className="flex flex-col gap-2">
            {enrolled.map((e) => (
              <EnrolledCourseRow key={e.courseId} enrollment={e} studentUid={user.uid} revoke={revoke} />
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
