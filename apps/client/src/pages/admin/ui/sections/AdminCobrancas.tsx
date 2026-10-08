import { useState } from 'react'
import { Receipt, ExternalLink, CheckCircle2 } from 'lucide-react'
import type { AdminOrderRow, OrderStatus } from '@pilari/types'
import { formatMoneyBRL } from '@/entities/course'
import {
  useAdminOrdersQuery,
  useSettleOrderMutation,
  useCancelOrderMutation,
  useSettleCarneMutation,
  formatBillingType,
  formatDueDate,
} from '@/entities/admin-orders'

const INSTALLMENT_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'pendente', cls: 'text-amber-600' },
  paid: { label: 'paga', cls: 'text-green-700' },
  overdue: { label: 'vencida', cls: 'text-red-500' },
  refunded: { label: 'estornada', cls: 'text-gray-400' },
}

const STATUS: Record<OrderStatus, { label: string; cls: string }> = {
  pending: { label: 'Pendente', cls: 'bg-amber-100 text-amber-700' },
  paid: { label: 'Pago', cls: 'bg-green-100 text-green-700' },
  canceled: { label: 'Cancelado', cls: 'bg-gray-100 text-gray-500' },
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function OrderRow({ o }: { o: AdminOrderRow }) {
  const settle = useSettleOrderMutation()
  const cancel = useCancelOrderMutation()
  const settleCarne = useSettleCarneMutation()
  const [confirming, setConfirming] = useState<null | 'settle' | 'cancel' | 'settleCarne'>(null)
  const st = STATUS[o.status]

  return (
    <tr className="border-b border-border align-top">
      <td className="py-2 pr-3 whitespace-nowrap text-muted">{fmtDate(o.createdAt)}</td>
      <td className="px-3">
        <p className="font-medium text-ink">{o.userName ?? '—'}</p>
        <p className="text-xs text-muted">{o.userEmail ?? '—'}</p>
      </td>
      <td className="px-3">
        {o.courseTitles.length ? (
          <ul className="flex flex-col gap-0.5">
            {o.courseTitles.map((t, i) => <li key={i} className="text-xs text-ink">{t}</li>)}
          </ul>
        ) : (
          <span className="text-xs text-muted">—</span>
        )}
        {o.installments.length > 0 && (
          <ul className="mt-1 flex flex-col gap-0.5 border-t border-border/50 pt-1">
            {o.installments.map((p, i) => {
              const is = INSTALLMENT_STATUS[p.status] ?? { label: p.status, cls: 'text-muted' }
              return (
                <li key={i} className="text-[11px] text-muted">
                  {p.installmentNumber ?? i + 1}ª {formatMoneyBRL(p.valueInCents)} <span className={is.cls}>· {is.label}</span>
                  {/* p.dueDate é data-pura (YYYY-MM-DD): fmtDate (via new Date()) leria como
                      UTC-meia-noite e mostraria o dia ANTERIOR em America/Sao_Paulo — usa
                      formatDueDate, que nunca passa a string por new Date(). */}
                  {p.dueDate ? ` · venc. ${formatDueDate(p.dueDate)}` : ''}
                </li>
              )
            })}
          </ul>
        )}
      </td>
      <td className="px-3 whitespace-nowrap text-xs text-muted">{formatBillingType(o.billingType, o.installmentCount)}</td>
      <td className="px-3 whitespace-nowrap font-medium text-ink">{formatMoneyBRL(o.totalInCents)}</td>
      <td className="px-3"><span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${st.cls}`}>{st.label}</span></td>
      <td className="px-3">
        <div className="flex flex-wrap items-center gap-2">
          {o.paymentUrl && (
            <a href={o.paymentUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
              <ExternalLink className="size-3.5" aria-hidden="true" /> fatura
            </a>
          )}

          {o.status === 'pending' && confirming === null && (
            <>
              <button type="button" onClick={() => setConfirming('settle')} className="rounded-full border border-green-600/40 bg-green-50 px-3 py-1 text-xs font-bold text-green-700 hover:bg-green-100">
                Dar baixa
              </button>
              <button type="button" onClick={() => setConfirming('cancel')} className="text-xs text-muted hover:text-red-500">
                Cancelar
              </button>
            </>
          )}

          {confirming === 'settle' && (
            <span className="inline-flex items-center gap-1">
              <button type="button" disabled={settle.isPending} onClick={() => settle.mutate(o.id, { onSettled: () => setConfirming(null) })} className="rounded-full bg-green-600 px-3 py-1 text-xs font-bold text-white hover:bg-green-700 disabled:opacity-60">
                {settle.isPending ? 'Baixando…' : 'Confirmar baixa'}
              </button>
              <button type="button" onClick={() => setConfirming(null)} className="text-xs text-muted hover:text-ink">voltar</button>
            </span>
          )}

          {confirming === 'cancel' && (
            <span className="inline-flex items-center gap-1">
              <button type="button" disabled={cancel.isPending} onClick={() => cancel.mutate(o.id, { onSettled: () => setConfirming(null) })} className="rounded-full bg-red-500 px-3 py-1 text-xs font-bold text-white hover:bg-red-600 disabled:opacity-60">
                {cancel.isPending ? 'Cancelando…' : 'Confirmar cancelamento'}
              </button>
              <button type="button" onClick={() => setConfirming(null)} className="text-xs text-muted hover:text-ink">voltar</button>
            </span>
          )}

          {o.status === 'paid' && o.settledAt === null && confirming === null && (
            <button type="button" onClick={() => setConfirming('settleCarne')} className="rounded-full border border-brand-600/40 bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700 hover:bg-brand-100">
              Quitar carnê
            </button>
          )}

          {confirming === 'settleCarne' && (
            <span className="inline-flex items-center gap-1">
              <button type="button" disabled={settleCarne.isPending} onClick={() => settleCarne.mutate(o.id, { onSettled: () => setConfirming(null) })} className="rounded-full bg-brand-600 px-3 py-1 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-60">
                {settleCarne.isPending ? 'Quitando…' : 'Confirmar quitação'}
              </button>
              <button type="button" onClick={() => setConfirming(null)} className="text-xs text-muted hover:text-ink">voltar</button>
            </span>
          )}

          {o.status === 'paid' && (
            <span className="inline-flex items-center gap-1 text-xs text-green-700">
              <CheckCircle2 className="size-3.5" aria-hidden="true" /> {o.settledAt ? fmtDate(o.settledAt) : `acesso liberado (${fmtDate(o.paidAt)})`}
            </span>
          )}
        </div>
        {(settle.isError || cancel.isError || settleCarne.isError) && <span className="mt-1 block text-xs text-red-500">erro na operação</span>}
      </td>
    </tr>
  )
}

import { FinanceiroDoAluno } from './FinanceiroDoAluno'

export function AdminCobrancas() {
  const { data, isLoading, isError } = useAdminOrdersQuery()
  const pending = data?.filter((o) => o.status === 'pending').length ?? 0

  return (
    <div>
      <h2 className="flex items-center gap-2 text-2xl font-bold text-ink">
        <Receipt className="size-6 text-brand" aria-hidden="true" /> Cobranças
      </h2>
      <p className="mt-1 text-sm text-muted">
        Todas as cobranças geradas. Use <strong>Dar baixa</strong> para confirmar um pagamento manualmente — libera o acesso do aluno e credita o repasse ao parceiro.
      </p>
      {/*
        A frase acima vale para pedido à vista. No carnê a baixa manual NÃO credita o
        repasse (o ganho é capturado por parcela, quando cada boleto é pago), e o pedido
        continua em aberto até a última parcela — por isso o aviso abaixo, em vez de
        deixar o admin achar que resolveu tudo num clique.
      */}
      <p className="mt-1 text-sm text-amber-700">
        Em pedido parcelado no boleto (carnê), a baixa manual libera o acesso mas <strong>não</strong> credita
        o repasse nem quita o pedido: cada parcela é creditada quando o boleto correspondente é pago.
      </p>

      {/* Ficha por aluno vem ANTES da lista geral: é por onde se resolve o caso de um aluno
          específico, que é o uso do dia a dia. A lista geral serve para ver a inadimplência. */}
      <FinanceiroDoAluno />

      <h3 className="mt-8 text-lg font-bold text-ink">Todas as cobranças</h3>

      {isLoading && <p className="mt-4 text-muted">Carregando…</p>}
      {isError && <p className="mt-4 text-red-500">Não foi possível carregar as cobranças.</p>}
      {data && (
        <>
          <p className="mt-3 text-sm text-muted">{data.length} cobrança(s){pending > 0 ? ` · ${pending} pendente(s)` : ''}</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-sm text-ink">
              <thead className="text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3 font-medium">Data</th>
                  <th className="px-3 font-medium">Aluno</th>
                  <th className="px-3 font-medium">Cursos</th>
                  <th className="px-3 font-medium">Forma</th>
                  <th className="px-3 font-medium">Valor</th>
                  <th className="px-3 font-medium">Status</th>
                  <th className="px-3 font-medium">Ação</th>
                </tr>
              </thead>
              <tbody>{data.map((o) => <OrderRow key={o.id} o={o} />)}</tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
