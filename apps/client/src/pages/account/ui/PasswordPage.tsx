import { useState } from 'react'
import { sendPasswordResetEmail } from 'firebase/auth'
import { KeyRound, MailCheck } from 'lucide-react'
import { firebaseAuth } from '@/shared/config/firebase'
import { useMyProfileQuery } from '@/entities/my-account'

export function PasswordPage() {
  const { data: p } = useMyProfileQuery()
  const [estado, setEstado] = useState<'idle' | 'enviando' | 'enviado' | 'erro'>('idle')

  async function enviar(): Promise<void> {
    if (!firebaseAuth || !p?.email) return
    setEstado('enviando')
    try {
      // Redefinição por e-mail em vez de formulário: a senha nunca passa pela nossa tela
      // nem pela nossa API, e funciona também para quem esqueceu a atual — um formulário
      // exigiria reautenticar com a senha antiga, que é justamente o que falta nesse caso.
      await sendPasswordResetEmail(firebaseAuth, p.email)
      setEstado('enviado')
    } catch {
      setEstado('erro')
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-ink">Senha</h2>
      <p className="mt-1 text-sm text-muted">Trocamos sua senha por um link enviado ao seu e-mail.</p>

      <div className="mt-5 flex max-w-xl flex-col gap-4 rounded-2xl border border-border bg-card p-5">
        <p className="text-sm text-ink">
          Vamos enviar um link de redefinição para <strong>{p?.email ?? 'seu e-mail'}</strong>. Ao
          clicar nele, você define a nova senha.
        </p>

        {estado === 'enviado' ? (
          <div className="flex items-center gap-2 rounded-xl border border-green-300 bg-green-50 px-4 py-3">
            <MailCheck className="size-5 shrink-0 text-green-700" aria-hidden="true" />
            <p className="text-sm font-medium text-green-900">
              Link enviado. Verifique a caixa de entrada e o spam.
            </p>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void enviar()}
            disabled={estado === 'enviando' || !p?.email}
            className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-full bg-brand px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            <KeyRound className="size-4" aria-hidden="true" />
            {estado === 'enviando' ? 'Enviando…' : 'Enviar link para alterar senha'}
          </button>
        )}

        {estado === 'erro' && (
          <p role="alert" className="text-sm font-medium text-red-600">
            Não foi possível enviar o e-mail agora. Tente novamente em alguns minutos.
          </p>
        )}
      </div>
    </div>
  )
}
