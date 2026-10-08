import { ExternalLink, FileText, Receipt } from 'lucide-react'
import type { MyOrder } from '@pilari/types'
import { formatPriceBRL } from '@/entities/course'
import {
  canPay, carneProgress, formatDateOnly, formatDateTime, installmentStatusLabel,
  orderStatusLabel, paymentModeLabel, useDownloadCarneMutation, useMyOrdersQuery,
} from '@/entities/my-account'

const STATUS_CLASS: Record<string, string> = {
  paid: 'bg-green-100 text-green-800',
  pending: 'bg-amber-100 text-amber-900',
  canceled: 'bg-red-100 text-red-800',
}

function OrderCard({ order }: { order: MyOrder }) {
  const carne = useDownloadCarneMutation()
  const progresso = carneProgress(order)

  return (
    <article className="rounded-2xl border border-border bg-card p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-bold text-ink">
            {order.courseTitles.length ? order.courseTitles.join(' · ') : 'Pedido'}
          </h3>
          <p className="mt-0.5 text-xs text-muted">
            {paymentModeLabel(order.paymentMode)} · pedido de {formatDateTime(order.createdAt)}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${STATUS_CLASS[order.status] ?? 'bg-brand-soft text-accent'}`}>
          {orderStatusLabel(order.status)}
        </span>
      </header>

      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
        <span className="font-bold text-accent">{formatPriceBRL(order.totalInCents)}</span>
        {order.status === 'pending' && order.dueDate && (
          <span className="text-muted">Vence em {formatDateOnly(order.dueDate)}</span>
        )}
        {order.paidAt && <span className="text-muted">Pago em {formatDateTime(order.paidAt)}</span>}
      </div>

      {progresso && (
        <div className="mt-4 rounded-xl bg-brand-soft/40 p-3">
          <p className="text-sm font-medium text-ink">
            Carnê: {progresso.pagas} de {progresso.total} parcelas pagas
            {progresso.quitado ? ' · quitado' : ''}
          </p>
          {/* O certificado depende da ÚLTIMA parcela: dizer isso aqui evita o aluno
              concluir o curso e não entender por que o certificado não sai. */}
          {!progresso.quitado && (
            <p className="mt-0.5 text-xs text-amber-800">
              O certificado é liberado após a última parcela.
            </p>
          )}
          <ul className="mt-3 flex flex-col gap-1">
            {order.installments.map((i, idx) => (
              // Sem id no contrato; o número da parcela é a chave natural e `idx` cobre
              // o caso (não esperado) de número nulo.
              <li key={i.installmentNumber ?? idx} className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-1 text-sm first:border-0 first:pt-0">
                <span className="text-ink">
                  {i.installmentNumber ?? '—'}ª · {formatPriceBRL(i.valueInCents)}
                </span>
                <span className="flex items-center gap-3 text-muted">
                  <span>{i.dueDate ? `vence ${formatDateOnly(i.dueDate)}` : ''}</span>
                  <span className={i.status === 'paid' ? 'font-bold text-green-700' : i.status === 'overdue' ? 'font-bold text-red-600' : ''}>
                    {installmentStatusLabel(i.status)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {canPay(order) && order.paymentUrl && (
          <a
            href={order.paymentUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-dark"
          >
            <ExternalLink className="size-4" aria-hidden="true" /> Pagar / ver boleto
          </a>
        )}
        {order.carneUrl && (
          <button
            type="button"
            onClick={() => order.carneUrl && carne.mutate(order.carneUrl)}
            disabled={carne.isPending}
            className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-bold text-accent transition-colors hover:bg-brand-soft disabled:opacity-60"
          >
            <FileText className="size-4" aria-hidden="true" /> {carne.isPending ? 'Baixando…' : 'Baixar carnê (PDF)'}
          </button>
        )}
      </div>
      {carne.isError && (
        <p role="alert" className="mt-2 text-sm font-medium text-red-600">
          {carne.error instanceof Error ? carne.error.message : 'Não foi possível baixar o carnê.'}
        </p>
      )}
    </article>
  )
}

export function FinancePage() {
  const { data, isLoading, isError } = useMyOrdersQuery()

  return (
    <div>
      <h2 className="text-2xl font-bold text-ink">Financeiro</h2>
      <p className="mt-1 text-sm text-muted">Seus pedidos, boletos e parcelas.</p>

      {isLoading && <p className="mt-4 text-muted">Carregando…</p>}
      {isError && <p className="mt-4 text-red-500">Não foi possível carregar seus pedidos.</p>}
      {data && data.length === 0 && (
        <div className="mt-5 flex flex-col items-center gap-2 rounded-2xl border border-border bg-card p-10 text-center">
          <Receipt className="size-8 text-muted" aria-hidden="true" />
          <p className="font-medium text-ink">Você ainda não tem pedidos</p>
          <p className="text-sm text-muted">Suas compras aparecem aqui, com boletos e parcelas.</p>
        </div>
      )}
      <div className="mt-5 flex flex-col gap-4">
        {data?.map((o) => <OrderCard key={o.id} order={o} />)}
      </div>
    </div>
  )
}
