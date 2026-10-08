import { useState } from 'react'
import { Check, KeyRound } from 'lucide-react'
import { useSendPasswordResetMutation } from '../queries'

function apiMessage(error: unknown, fallback: string): string {
  const msg = (error as { response?: { data?: { message?: string | string[] } } } | null)?.response?.data?.message
  if (Array.isArray(msg)) return msg.join(' ')
  return msg ?? fallback
}

/**
 * Dispara o e-mail de redefinição de senha para o titular (admin). O admin não escolhe nem
 * vê a senha/link — o Firebase envia direto ao usuário, e as sessões ativas são derrubadas.
 */
export function ResetPasswordButton({ uid }: { uid: string }) {
  const [open, setOpen] = useState(false)
  const mutation = useSendPasswordResetMutation()

  if (mutation.isSuccess && !open) {
    return (
      <span className="inline-flex items-center gap-1 text-sm font-medium text-accent">
        <Check className="size-4" aria-hidden="true" /> Link enviado por e-mail
      </span>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { mutation.reset(); setOpen(true) }}
        className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm font-medium text-ink hover:bg-brand-soft"
      >
        <KeyRound className="size-4" aria-hidden="true" /> Resetar senha
      </button>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted">Enviar link de redefinição ao e-mail do usuário? (desloga as sessões ativas)</span>
      <button
        type="button"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate(uid, { onSuccess: () => setOpen(false) })}
        className="rounded-full bg-brand px-3 py-1.5 text-sm font-bold text-white disabled:opacity-60"
      >
        {mutation.isPending ? 'Enviando…' : 'Enviar'}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-sm text-muted hover:text-ink">Cancelar</button>
      {mutation.isError && <span className="basis-full text-xs text-red-500">{apiMessage(mutation.error, 'Erro ao enviar o link de redefinição.')}</span>}
    </div>
  )
}
