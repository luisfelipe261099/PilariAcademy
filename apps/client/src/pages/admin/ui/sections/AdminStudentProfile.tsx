import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Save, UserRound } from 'lucide-react'
import { Role } from '@pilari/types'
import { useTenant } from '@/entities/tenant'
import {
  ManageEnrollmentsButton,
  ResetPasswordButton,
  buildAdminProfilePatch,
  cpfHint,
  formatCpf,
  isMaskedCpf,
  useAdminUserDetailQuery,
  useUpdateUserMutation,
} from '@/entities/admin-user'

const ROLE_LABEL: Record<Role, string> = { [Role.student]: 'Aluno', [Role.teacher]: 'Parceiro', [Role.admin]: 'Admin' }

function apiMessage(error: unknown, fallback: string): string {
  const msg = (error as { response?: { data?: { message?: string | string[] } } } | null)?.response?.data?.message
  if (Array.isArray(msg)) return msg.join(' ')
  return msg ?? fallback
}

const inputClass = 'rounded-lg border border-border bg-bg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-brand'
const readOnlyClass = 'cursor-not-allowed rounded-lg border border-border bg-brand-soft/40 px-3 py-2 text-muted'
const badgeClass = 'rounded-full px-2.5 py-0.5 text-xs font-semibold'

/** Perfil do aluno para o admin: dados editáveis (nome, CPF) + ações que já existiam na lista. */
export function AdminStudentProfile() {
  const { uid } = useParams<{ uid: string }>()
  const query = useAdminUserDetailQuery(uid)
  const save = useUpdateUserMutation(uid ?? '')
  const { salesEnabled } = useTenant()
  const u = query.data

  // `undefined` = ainda não editou; aí o valor exibido é o do servidor (mesma técnica do
  // ProfilePage: um campo controlado por `?? ''` apagaria o nome enquanto a query recarrega).
  const [nome, setNome] = useState<string | undefined>(undefined)
  const [cpf, setCpf] = useState<string | undefined>(undefined)

  if (!uid) return <p className="text-red-500">Aluno não informado.</p>
  if (query.isLoading) return <p className="text-muted">Carregando…</p>
  if (query.isError || !u) return <p className="text-red-500">Não foi possível carregar o aluno.</p>

  const nomeAtual = nome ?? u.displayName ?? ''
  // Pessoa ligada a outro polo: o servidor manda o CPF mascarado. Aparece como veio, só leitura, e não volta no salvar.
  const cpfMascarado = isMaskedCpf(u.cpf)
  const cpfAtual = cpfMascarado ? (u.cpf ?? '') : (cpf ?? formatCpf(u.cpf ?? ''))
  const editou = nome !== undefined || cpf !== undefined
  const decisao = buildAdminProfilePatch({ displayName: u.displayName, cpf: u.cpf }, { nome: nomeAtual, cpf: cpfAtual })
  const iniciais = (u.displayName ?? u.email).slice(0, 2).toUpperCase()

  return (
    <div>
      <Link to="/admin/alunos" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden="true" /> Alunos
      </Link>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-full bg-brand-soft text-lg font-bold text-brand">
            {iniciais}
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-2xl font-bold text-ink">{u.displayName ?? 'Sem nome'}</h2>
            <p className="truncate text-sm text-muted">{u.email}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className={`${badgeClass} ${u.disabled ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                {u.disabled ? 'Desabilitado' : 'Ativo'}
              </span>
              {u.roles.map((r) => (
                <span key={r} className={`${badgeClass} bg-brand-soft text-brand`}>
                  {ROLE_LABEL[r] ?? r}
                </span>
              ))}
              {u.createdAt && (
                <span className="text-xs text-muted">desde {new Date(u.createdAt).toLocaleDateString('pt-BR')}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <ManageEnrollmentsButton user={u} />
          <ResetPasswordButton uid={u.uid} />
        </div>
      </div>

      <div className="mt-6 flex max-w-xl flex-col gap-4 rounded-2xl border border-border bg-card p-5">
        <h3 className="flex items-center gap-2 text-lg font-bold text-ink">
          <UserRound className="size-5 text-brand" aria-hidden="true" /> Dados do aluno
        </h3>
        <p className="text-sm text-muted">
          Nome e CPF vão impressos no certificado. Correções aqui valem para as próximas emissões.
        </p>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">Nome completo</span>
          <input type="text" value={nomeAtual} onChange={(e) => setNome(e.target.value)} maxLength={120} className={inputClass} />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">E-mail</span>
          <input
            type="email"
            value={u.email}
            readOnly
            aria-readonly="true"
            className={readOnlyClass}
          />
          <span className="text-xs text-muted">Identifica a conta no login e não pode ser alterado por aqui.</span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">CPF</span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="000.000.000-00"
            value={cpfAtual}
            onChange={(e) => setCpf(formatCpf(e.target.value))}
            maxLength={14}
            readOnly={cpfMascarado}
            aria-readonly={cpfMascarado ? 'true' : undefined}
            className={cpfMascarado ? readOnlyClass : inputClass}
          />
          <span className="text-xs text-muted">{cpfHint(u.cpf, salesEnabled)}</span>
        </label>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (!decisao.ok) return
              save.mutate(decisao.patch, { onSuccess: () => { setNome(undefined); setCpf(undefined) } })
            }}
            disabled={!decisao.ok || save.isPending}
            className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-brand px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Save className="size-4" aria-hidden="true" /> {save.isPending ? 'Salvando…' : 'Salvar'}
          </button>
          {save.isSuccess && !editou && <span className="text-sm font-medium text-green-700">Dados salvos.</span>}
        </div>
        {editou && !decisao.ok && decisao.error && (
          <p role="alert" className="text-sm font-medium text-red-600">{decisao.error}</p>
        )}
        {save.isError && (
          <p role="alert" className="text-sm font-medium text-red-600">{apiMessage(save.error, 'Não foi possível salvar.')}</p>
        )}
      </div>

      {salesEnabled && (
        <p className="mt-4 text-sm text-muted">
          Cobranças e parcelas deste aluno ficam na aba{' '}
          <Link to="/admin/financeiro" className="font-medium text-brand hover:underline">Financeiro</Link>.
        </p>
      )}
    </div>
  )
}
