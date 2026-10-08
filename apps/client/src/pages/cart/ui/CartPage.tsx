import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Trash2, ShoppingCart } from 'lucide-react'
import type { PaymentMode } from '@pilari/types'
import { formatPriceBRL } from '@/entities/course'
import { useCart } from '@/shared/cart'
import { useAuthStore } from '@/entities/auth'
import { useCartSummaryQuery, useCheckoutMutation, installmentLabel, maxInstallmentsFor } from '@/entities/cart'
import { useMyEnrollmentsQuery } from '@/entities/enrollment'
import { useTenant } from '@/entities/tenant'
import { SalesDisabledNotice } from './SalesDisabledNotice'

function apiMessage(error: unknown, fallback: string): string {
  const msg = (error as { response?: { data?: { message?: string | string[] } } } | null)?.response?.data?.message
  if (Array.isArray(msg)) return msg.join(' ')
  return msg ?? fallback
}

function CartCheckout() {
  const ids = useCart((s) => s.ids)
  const removeFromCart = useCart((s) => s.remove)
  // O resumo do carrinho é PÚBLICO e não sabe quem é o aluno, então ele soma até o que o
  // aluno já tem. Sem marcar aqui, a tela promete um total que o checkout vai recusar.
  const enrollmentsQuery = useMyEnrollmentsQuery()
  const jaMatriculado = new Set(
    (enrollmentsQuery.data ?? []).filter((e) => e.status === 'active').map((e) => e.courseId)
  )
  const [couponInput, setCouponInput] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState<string | undefined>(undefined)
  const [cpf, setCpf] = useState('')
  const [rawPaymentMode, setPaymentMode] = useState<PaymentMode>('avista')
  const [boletoParcelas, setBoletoParcelas] = useState(0)

  const summaryQuery = useCartSummaryQuery(ids, appliedCoupon)
  const checkoutMutation = useCheckoutMutation()
  const summary = summaryQuery.data
  // Trava o botão: o checkout recusa esse carrinho, e antes da correção ele cobrava só a
  // diferença — um total na tela que nunca virava cobrança.
  const temJaMatriculado = (summary?.items ?? []).some((i) => jaMatriculado.has(i.id))
  const navigate = useNavigate()
  const authStatus = useAuthStore((s) => s.status)
  const isAuthenticated = authStatus === 'authenticated'

  // Cada modalidade tem piso e teto próprios (boleto: R$ 10 / até 5x; cartão: R$ 5 / até 10x).
  const maxBoleto = maxInstallmentsFor(summary?.totalInCents ?? 0, 'boleto_parcelado')
  const labelCartao = installmentLabel(summary?.totalInCents ?? 0, 'cartao_parcelado')
  const labelBoleto = installmentLabel(summary?.totalInCents ?? 0, 'boleto_parcelado')
  // Se o total mudar (ex.: cupom aplicado) e a modalidade escolhida deixar de ser oferecida,
  // trata como "à vista" em vez de submeter uma combinação que o server recusa. Derivado no
  // render (sem efeito) — o estado bruto só muda por interação do usuário.
  const paymentMode: PaymentMode =
    (rawPaymentMode === 'cartao_parcelado' && !labelCartao) || (rawPaymentMode === 'boleto_parcelado' && !labelBoleto)
      ? 'avista'
      : rawPaymentMode
  // Mantém a parcela escolhida dentro do novo teto quando o total encolhe (ex.: cupom).
  const boletoCount = Math.min(Math.max(boletoParcelas, 2), Math.max(maxBoleto, 2))

  function finalize() {
    // Visitante anônimo: manda pro login preservando o carrinho; volta pro carrinho ao logar.
    if (!isAuthenticated) {
      navigate('/login', { state: { from: '/carrinho' } })
      return
    }
    checkoutMutation.mutate(
      {
        courseIds: ids,
        couponCode: appliedCoupon,
        cpf: cpf || undefined,
        paymentMode,
        installmentCount: paymentMode === 'boleto_parcelado' ? boletoCount : undefined,
      },
      {
        onSuccess: (res) => {
          // Só navega para a URL de pagamento se for https (defesa contra `javascript:` etc.
          // caso o backend algum dia reflita entrada de terceiros nesse campo).
          if (res.paymentUrl && /^https:\/\//i.test(res.paymentUrl)) window.location.assign(res.paymentUrl)
          else window.location.assign('/dashboard')
        },
      }
    )
  }

  if (ids.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center sm:px-6">
        <ShoppingCart className="mx-auto size-12 text-muted" aria-hidden="true" />
        <h1 className="mt-4 text-2xl font-bold text-ink">Seu carrinho está vazio</h1>
        <p className="mt-2 text-muted">Explore o catálogo e adicione cursos para comprar.</p>
        <Link to="/#cursos" className="mt-6 inline-block rounded-full bg-brand px-6 py-3 font-bold text-white transition-colors hover:bg-brand-dark">
          Ver cursos
        </Link>
      </div>
    )
  }

  const needsCpf = (summary?.totalInCents ?? 0) > 0
  // O carnê exige CPF na cobrança; nas demais modalidades o CPF é opcional. Validação de
  // conveniência — o server também valida.
  const cpfMissingForBoleto = paymentMode === 'boleto_parcelado' && !cpf.trim()

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold text-ink">Carrinho de compras</h1>
      <p className="mt-1 text-muted">{ids.length} {ids.length === 1 ? 'curso' : 'cursos'} no carrinho</p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_360px]">
        {/* Itens */}
        <div className="flex flex-col gap-4">
          {summaryQuery.isLoading && <p className="text-muted">Carregando…</p>}
          {summaryQuery.isError && <p className="text-red-500">Não foi possível carregar o carrinho.</p>}
          {summary?.items.map((item) => (
            <div
              key={item.id}
              className={`flex gap-4 rounded-2xl border bg-card p-4 ${jaMatriculado.has(item.id) ? 'border-amber-400' : 'border-border'}`}
            >
              <div className="h-20 w-32 shrink-0 overflow-hidden rounded-lg bg-brand-soft">
                {item.coverImageUrl && <img src={item.coverImageUrl} alt={item.title} style={{ objectPosition: item.coverFocus ?? '50% 100%' }} className="size-full object-cover" />}
              </div>
              <div className="flex flex-1 flex-col">
                <span className="font-bold text-ink">{item.title}</span>
                {item.category && <span className="text-xs text-muted">{item.category.name}</span>}
                {jaMatriculado.has(item.id) ? (
                  <span className="mt-auto text-sm font-bold text-amber-700">
                    Você já tem este curso — remova para finalizar a compra
                  </span>
                ) : (
                  <span className="mt-auto font-bold text-accent">{formatPriceBRL(item.priceInCents)}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeFromCart(item.id)}
                aria-label={`Remover ${item.title}`}
                className="self-start text-muted transition-colors hover:text-red-500"
              >
                <Trash2 className="size-5" />
              </button>
            </div>
          ))}
        </div>

        {/* Resumo */}
        <aside className="h-fit rounded-2xl border border-border bg-card p-5">
          <h2 className="text-lg font-bold text-ink">Resumo</h2>

          <div className="mt-4 flex gap-2">
            <input
              value={couponInput}
              onChange={(e) => setCouponInput(e.target.value)}
              placeholder="Cupom"
              className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
            />
            <button
              type="button"
              onClick={() => setAppliedCoupon(couponInput.trim() || undefined)}
              className="rounded-lg border border-brand px-4 py-2 text-sm font-bold text-brand transition-colors hover:bg-brand-soft"
            >
              Aplicar
            </button>
          </div>
          {summary?.couponError && <p className="mt-1 text-sm text-red-500">{summary.couponError}</p>}

          <dl className="mt-5 space-y-2 text-sm">
            <div className="flex justify-between text-muted">
              <dt>Subtotal</dt>
              <dd>{formatPriceBRL(summary?.subtotalInCents ?? 0)}</dd>
            </div>
            {(summary?.discountInCents ?? 0) > 0 && (
              <div className="flex justify-between text-accent">
                <dt>Desconto {summary?.couponCode ? `(${summary.couponCode})` : ''}</dt>
                <dd>- {formatPriceBRL(summary?.discountInCents ?? 0)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-border pt-2 text-lg font-bold text-ink">
              <dt>Total</dt>
              <dd>{formatPriceBRL(summary?.totalInCents ?? 0)}</dd>
            </div>
          </dl>

          {needsCpf && (
            <>
              <input
                value={cpf}
                onChange={(e) => setCpf(e.target.value)}
                inputMode="numeric"
                placeholder="CPF (para a cobrança)"
                className="mt-4 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
              />
              {paymentMode === 'boleto_parcelado' && (
                <p className="mt-1 text-xs text-muted">O CPF é obrigatório para emitir o carnê.</p>
              )}
            </>
          )}

          {checkoutMutation.isError && (
            <p className="mt-2 text-sm text-red-500">{apiMessage(checkoutMutation.error, 'Não foi possível finalizar.')}</p>
          )}

          <fieldset className="mt-4">
            <legend className="text-sm font-medium text-ink">Como quer pagar?</legend>
            <label className="mt-2 flex cursor-pointer items-start gap-2">
              <input
                type="radio"
                name="forma-pagamento"
                checked={paymentMode === 'avista'}
                onChange={() => setPaymentMode('avista')}
                className="mt-1"
              />
              <span className="text-sm">
                <span className="block text-ink">À vista</span>
                <span className="block text-xs text-muted">Pix, boleto ou cartão</span>
              </span>
            </label>

            {labelCartao && (
              <label className="mt-2 flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name="forma-pagamento"
                  checked={paymentMode === 'cartao_parcelado'}
                  onChange={() => setPaymentMode('cartao_parcelado')}
                  className="mt-1"
                />
                <span className="text-sm">
                  <span className="block text-ink">Parcelar no cartão</span>
                  <span className="block text-xs text-muted">{labelCartao}</span>
                </span>
              </label>
            )}

            {labelBoleto && (
              <label className="mt-2 flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name="forma-pagamento"
                  checked={paymentMode === 'boleto_parcelado'}
                  onChange={() => {
                    setPaymentMode('boleto_parcelado')
                    setBoletoParcelas(maxBoleto)
                  }}
                  className="mt-1"
                />
                <span className="w-full text-sm">
                  <span className="block text-ink">Parcelar no carnê (boleto)</span>
                  <span className="block text-xs text-muted">{labelBoleto}</span>
                  {paymentMode === 'boleto_parcelado' && (
                    <>
                      <select
                        value={boletoCount}
                        onChange={(e) => setBoletoParcelas(Number(e.target.value))}
                        className="mt-2 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                      >
                        {Array.from({ length: maxBoleto - 1 }, (_, i) => i + 2).map((n) => (
                          <option key={n} value={n}>
                            {n}x de R${' '}
                            {(Math.ceil((summary?.totalInCents ?? 0) / n) / 100).toLocaleString('pt-BR', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </option>
                        ))}
                      </select>
                      <span className="mt-1 block text-xs text-muted">
                        Carnê com {boletoCount} boletos mensais. O certificado é liberado após a última parcela.
                      </span>
                    </>
                  )}
                </span>
              </label>
            )}
          </fieldset>

          {temJaMatriculado && (
            <p role="alert" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
              O total acima inclui curso que você já possui. Remova-o para finalizar — você não será
              cobrado por ele.
            </p>
          )}

          <button
            type="button"
            onClick={finalize}
            disabled={checkoutMutation.isPending || summaryQuery.isLoading || temJaMatriculado || (isAuthenticated && cpfMissingForBoleto)}
            className="mt-4 w-full rounded-full bg-brand px-6 py-3 font-bold text-white shadow-lg transition-colors hover:bg-brand-dark disabled:opacity-60"
          >
            {checkoutMutation.isPending ? 'Processando…' : isAuthenticated ? 'Finalizar compra' : 'Entrar para finalizar'}
          </button>
          <p className="mt-2 text-center text-xs text-muted">
            {paymentMode === 'cartao_parcelado' && 'Pagamento seguro via Asaas (cartão de crédito).'}
            {paymentMode === 'boleto_parcelado' && 'Pagamento seguro via Asaas (carnê de boletos).'}
            {paymentMode === 'avista' && 'Pagamento seguro via Asaas (Pix, boleto ou cartão).'}
          </p>
        </aside>
      </div>
    </div>
  )
}

/** O carrinho só existe onde há venda online; nos polos sem venda, explica como se matricular. */
export function CartPage() {
  const { salesEnabled } = useTenant()
  return salesEnabled ? <CartCheckout /> : <SalesDisabledNotice />
}
