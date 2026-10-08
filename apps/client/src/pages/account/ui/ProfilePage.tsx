import { useState } from 'react'
import { Lock, Save } from 'lucide-react'
import { useMyProfileQuery, useUpdateMyProfileMutation } from '@/entities/my-account'
import { useTenant } from '@/entities/tenant'
import { isValidFullName } from '@/entities/certificate/lib/certificate-form'
import { profileCopy } from '@/shared/lib/brand-copy'

function apiMessage(error: unknown, fallback: string): string {
  const msg = (error as { response?: { data?: { message?: string | string[] } } } | null)?.response?.data?.message
  if (Array.isArray(msg)) return msg.join(' ')
  return msg ?? fallback
}

function formatCpf(digits: string): string {
  const d = digits.replace(/\D/g, '').slice(0, 11)
  if (d.length !== 11) return d
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

export function ProfilePage() {
  const profileQuery = useMyProfileQuery()
  const save = useUpdateMyProfileMutation()
  const tenant = useTenant()
  const copy = profileCopy(tenant)
  const p = profileQuery.data

  // `undefined` = ainda não editou; aí o valor exibido é o do servidor. Sem essa distinção,
  // um campo controlado por `?? ''` apagaria o nome enquanto a query recarrega.
  const [nome, setNome] = useState<string | undefined>(undefined)
  const [cpf, setCpf] = useState('')
  const nomeAtual = nome ?? p?.displayName ?? ''

  if (profileQuery.isLoading) return <p className="text-muted">Carregando…</p>
  if (profileQuery.isError || !p) return <p className="text-red-500">Não foi possível carregar seus dados.</p>

  const nomeMudou = nomeAtual.trim() !== (p.displayName ?? '').trim()
  const cpfDigits = cpf.replace(/\D/g, '')
  const cpfPreenchendo = !p.cpfLocked && cpfDigits.length > 0
  const podeSalvar =
    (nomeMudou && isValidFullName(nomeAtual)) || (cpfPreenchendo && cpfDigits.length === 11)

  return (
    <div>
      <h2 className="text-2xl font-bold text-ink">Meus dados</h2>
      <p className="mt-1 text-sm text-muted">
        Estes dados vão impressos no seu certificado. Confira antes de emitir.
      </p>

      <div className="mt-5 flex max-w-xl flex-col gap-4 rounded-2xl border border-border bg-card p-5">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">Nome completo</span>
          <input
            type="text"
            value={nomeAtual}
            onChange={(e) => setNome(e.target.value)}
            maxLength={120}
            className="rounded-lg border border-border bg-bg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-brand"
          />
          <span className="text-xs text-muted">É o nome que sai no certificado.</span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">E-mail</span>
          <input
            type="email"
            value={p.email ?? ''}
            readOnly
            aria-readonly="true"
            className="cursor-not-allowed rounded-lg border border-border bg-brand-soft/40 px-3 py-2 text-muted"
          />
          <span className="text-xs text-muted">Identifica sua conta e não pode ser alterado por aqui.</span>
        </label>

        {p.cpfLocked ? (
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-ink">CPF</span>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-brand-soft/40 px-3 py-2 text-muted">
              <Lock className="size-4 shrink-0" aria-hidden="true" />
              <span>{formatCpf(p.cpf ?? '')}</span>
            </div>
            {/* Write-once de propósito: o CPF é congelado no certificado já emitido e é o
                documento da cobrança no Asaas. Editar aqui não corrigiria o que já saiu. */}
            <span className="text-xs text-muted">{copy.cpfLocked}</span>
          </div>
        ) : (
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-ink">CPF</span>
            <input
              type="text"
              inputMode="numeric"
              placeholder="000.000.000-00"
              value={cpf}
              onChange={(e) => setCpf(e.target.value)}
              maxLength={14}
              className="rounded-lg border border-border bg-bg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-brand"
            />
            <span className="text-xs text-muted">{copy.cpfOpen}</span>
          </label>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() =>
              save.mutate(
                {
                  ...(nomeMudou ? { displayName: nomeAtual.trim().replace(/\s+/g, ' ') } : {}),
                  ...(cpfPreenchendo ? { cpf: cpfDigits } : {}),
                },
                { onSuccess: () => { setNome(undefined); setCpf('') } }
              )
            }
            disabled={!podeSalvar || save.isPending}
            className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-brand px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Save className="size-4" aria-hidden="true" /> {save.isPending ? 'Salvando…' : 'Salvar'}
          </button>
          {save.isSuccess && !nomeMudou && !cpfPreenchendo && (
            <span className="text-sm font-medium text-green-700">Dados salvos.</span>
          )}
        </div>
        {save.isError && (
          <p role="alert" className="text-sm font-medium text-red-600">
            {apiMessage(save.error, 'Não foi possível salvar.')}
          </p>
        )}
      </div>
    </div>
  )
}
