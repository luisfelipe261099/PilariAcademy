import { useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import type { CouponType } from '@pilari/types'
import {
  useCouponsQuery,
  useCreateCouponMutation,
  useDeleteCouponMutation,
  useToggleCouponMutation,
} from '@/entities/coupon'

export function CouponManager() {
  const couponsQuery = useCouponsQuery()
  const createMutation = useCreateCouponMutation()
  const deleteMutation = useDeleteCouponMutation()
  const toggleMutation = useToggleCouponMutation()

  const [code, setCode] = useState('')
  const [type, setType] = useState<CouponType>('percent')
  const [value, setValue] = useState('')

  function onCreate(e: FormEvent) {
    e.preventDefault()
    const num = Number(value)
    if (!code.trim() || Number.isNaN(num)) return
    // percent: valor direto (0–100); fixed: usuário digita em reais → centavos
    const finalValue = type === 'percent' ? Math.round(num) : Math.round(num * 100)
    createMutation.mutate(
      { code: code.trim().toUpperCase(), type, value: finalValue },
      { onSuccess: () => { setCode(''); setValue('') } }
    )
  }

  return (
    <section className="mb-8 rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 font-bold text-foreground">Cupons</h2>

      <form onSubmit={onCreate} className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        <input
          type="text"
          placeholder="Código (ex.: BEMVINDO20)"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="w-full rounded-lg border border-border bg-bg px-4 py-2 text-foreground sm:min-w-0 sm:flex-1"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as CouponType)}
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-foreground sm:w-auto"
        >
          <option value="percent">% percentual</option>
          <option value="fixed">R$ fixo</option>
        </select>
        <input
          type="number"
          step="0.01"
          placeholder={type === 'percent' ? '20' : '50,00'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-foreground sm:w-28"
        />
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="w-full rounded-full bg-brand px-5 py-2 font-bold text-white disabled:opacity-60 sm:w-auto"
        >
          {createMutation.isPending ? 'Criando…' : 'Adicionar'}
        </button>
      </form>

      {couponsQuery.isLoading && <p className="text-muted-foreground">Carregando…</p>}
      {couponsQuery.isError && <p className="text-red-500">Não foi possível carregar os cupons.</p>}

      <ul className="flex flex-col gap-2">
        {couponsQuery.data?.map((c) => (
          <li key={c.id} className="flex items-center justify-between rounded-lg border border-border bg-bg p-3">
            <span className="text-foreground">
              <span className="font-bold">{c.code}</span>{' '}
              <span className="text-sm text-muted-foreground">
                {c.type === 'percent' ? `${c.value}%` : `R$ ${(c.value / 100).toFixed(2)}`}
              </span>
            </span>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={c.active}
                  onChange={() => toggleMutation.mutate({ id: c.id, active: !c.active })}
                />
                ativo
              </label>
              <button
                type="button"
                onClick={() => deleteMutation.mutate(c.id)}
                aria-label={`Remover ${c.code}`}
                className="text-muted-foreground transition-colors hover:text-red-500"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
