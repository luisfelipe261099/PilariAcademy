import { formatMoneyBRL } from '@/entities/course'
import { useInstructorEarningsQuery } from '@/entities/finance'

export function GanhosInstrutor() {
  const { data, isLoading, isError } = useInstructorEarningsQuery()

  return (
    <section className="mt-8 rounded-2xl border border-border bg-card p-5">
      <h2 className="mb-3 text-xl font-bold text-ink">Meus ganhos</h2>
      {isLoading && <p className="text-muted">Carregando…</p>}
      {isError && <p className="text-red-500">Não foi possível carregar seus ganhos.</p>}
      {data && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-bg p-4">
              <span className="block text-xs text-muted">A receber</span>
              <span className="block text-xl font-bold text-accent">{formatMoneyBRL(data.owedInCents)}</span>
            </div>
            <div className="rounded-xl border border-border bg-bg p-4">
              <span className="block text-xs text-muted">Recebido</span>
              <span className="block text-xl font-bold text-ink">{formatMoneyBRL(data.paidInCents)}</span>
            </div>
            <div className="rounded-xl border border-border bg-bg p-4">
              <span className="block text-xs text-muted">Total</span>
              <span className="block text-xl font-bold text-ink">{formatMoneyBRL(data.netInCents)}</span>
            </div>
          </div>
          {data.payouts.length > 0 && (
            <ul className="mt-4 flex flex-col gap-1 text-sm text-muted">
              {data.payouts.map((p) => (
                <li key={p.id}>Repasse de {formatMoneyBRL(p.amountInCents)} em {new Date(p.paidAt).toLocaleDateString('pt-BR')}{p.note ? ` — ${p.note}` : ''}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
