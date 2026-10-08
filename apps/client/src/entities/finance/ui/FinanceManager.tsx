import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { InstructorFinance } from '@pilari/types'
import { useMeQuery } from '@/entities/auth'
import { formatMoneyBRL } from '@/entities/course'
import { useAdminFinanceQuery, useReconcileAsaasMutation, useRegisterPayoutMutation } from '@/entities/finance'

function apiMessage(error: unknown, fallback: string): string {
  const msg = (error as { response?: { data?: { message?: string | string[] } } } | null)?.response?.data?.message
  if (Array.isArray(msg)) return msg.join(' ')
  return msg ?? fallback
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-bg p-4">
      <span className="block text-xs text-muted-foreground">{label}</span>
      <span className="block text-xl font-bold text-foreground">{value}</span>
    </div>
  )
}

/**
 * Puxa o status no Asaas e libera pedidos pagos que ficaram pending (webhook perdido).
 * A rota é só da plataforma: o FinanceManager nem mostra o botão para quem não é.
 */
function ReconcileButton() {
  const mutation = useReconcileAsaasMutation()
  const r = mutation.data
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        title="Consulta o Asaas e libera boletos já pagos que ficaram pendentes por webhook perdido."
        className="inline-flex items-center gap-2 rounded-full border border-brand/40 bg-brand-soft px-4 py-1.5 text-sm font-bold text-brand hover:bg-brand/10 disabled:opacity-60"
      >
        <RefreshCw className={`size-4 ${mutation.isPending ? 'animate-spin' : ''}`} aria-hidden="true" />
        {mutation.isPending ? 'Consultando Asaas…' : 'Reconciliar com Asaas'}
      </button>
      {r && (
        <span className="text-sm text-muted-foreground">
          {r.reconciled > 0 ? (
            <><strong className="text-foreground">{r.reconciled}</strong> liberado(s)</>
          ) : (
            'Nada novo'
          )}
          {` · ${r.stillPending} ainda pendente(s)`}
          {r.failed > 0 ? ` · ${r.failed} falha(s)` : ''}
        </span>
      )}
      {mutation.isError && <span className="text-sm text-red-500">{apiMessage(mutation.error, 'Falha ao reconciliar.')}</span>}
    </div>
  )
}

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function PayoutRow({ inst }: { inst: InstructorFinance }) {
  const mutation = useRegisterPayoutMutation()
  const [reais, setReais] = useState((inst.owedInCents / 100).toFixed(2))

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-bg p-3">
      <div>
        <p className="font-medium text-foreground">{inst.instructorName ?? inst.instructorId}</p>
        <p className="text-sm text-muted-foreground">
          No mês: <span className="font-medium text-foreground">{formatMoneyBRL(inst.monthNetInCents)}</span>
          {' · '}A receber (total): {formatMoneyBRL(inst.owedInCents)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <input value={reais} onChange={(e) => setReais(e.target.value)} inputMode="decimal" className="w-24 rounded border border-border bg-card px-2 py-1 text-sm text-foreground" />
        <button
          type="button"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate({ instructorId: inst.instructorId, amountInCents: Math.round(Number(reais.replace(',', '.')) * 100) || 0 })}
          className="rounded-full bg-brand px-4 py-1.5 text-sm font-bold text-white disabled:opacity-60"
        >
          Registrar repasse
        </button>
      </div>
    </li>
  )
}

export function FinanceManager() {
  const [month, setMonth] = useState(currentMonth())
  const { data, isLoading, isError } = useAdminFinanceQuery(month)
  const { data: me } = useMeQuery()

  return (
    <section className="mb-8 rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold text-foreground">Financeiro</h2>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Mês de referência
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value || currentMonth())}
            className="rounded border border-border bg-bg px-2 py-1 text-sm text-foreground"
          />
        </label>
      </div>
      {me?.user?.isPlatformAdmin && <ReconcileButton />}
      {isLoading && <p className="text-muted-foreground">Carregando…</p>}
      {isError && <p className="text-red-500">Não foi possível carregar o financeiro.</p>}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Card label="Receita (bruto)" value={formatMoneyBRL(data.grossInCents)} />
            <Card label="Taxa Asaas" value={formatMoneyBRL(data.asaasFeeInCents)} />
            <Card label="Lucro da plataforma" value={formatMoneyBRL(data.commissionInCents)} />
            <Card label="Devido aos instrutores" value={formatMoneyBRL(data.netInCents)} />
            <Card label={`Gerado no mês (${data.month})`} value={formatMoneyBRL(data.monthNetInCents)} />
          </div>

          <h3 className="mt-5 mb-2 font-bold text-foreground">Vendas (quem comprou)</h3>
          {data.sales.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma venda paga ainda.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-foreground">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="py-2 pr-3 font-medium">Data</th>
                    <th className="px-3 font-medium">Comprador</th>
                    <th className="px-3 font-medium">Cursos</th>
                    <th className="px-3 font-medium">Bruto</th>
                    <th className="px-3 font-medium">Taxa Asaas</th>
                    <th className="px-3 font-medium">Parceiro</th>
                    <th className="px-3 font-medium">Plataforma</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sales.map((s) => (
                    <tr key={s.orderId} className="border-b border-border align-top">
                      <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">{fmtDate(s.paidAt)}</td>
                      <td className="px-3">
                        <p className="font-medium">{s.buyerName ?? '—'}</p>
                        <p className="text-xs text-muted-foreground">{s.buyerEmail ?? '—'}</p>
                      </td>
                      <td className="px-3">{s.courseTitles.length ? s.courseTitles.join(', ') : '—'}</td>
                      <td className="px-3 whitespace-nowrap">{formatMoneyBRL(s.grossInCents)}</td>
                      <td className="px-3 whitespace-nowrap text-muted-foreground">− {formatMoneyBRL(s.asaasFeeInCents)}</td>
                      <td className="px-3 whitespace-nowrap">{formatMoneyBRL(s.netInCents)}</td>
                      <td className="px-3 whitespace-nowrap font-medium text-green-700">{formatMoneyBRL(s.platformInCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 className="mt-5 mb-2 font-bold text-foreground">Repasses por parceiro</h3>
          {data.instructors.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma venda paga ainda.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.instructors.map((i) => <PayoutRow key={i.instructorId} inst={i} />)}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
