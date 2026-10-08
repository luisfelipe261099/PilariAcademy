import { useState, type FormEvent } from 'react'
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'firebase/auth'
import { Mail, Lock } from 'lucide-react'
import { firebaseAuth, hasFirebaseConfig } from '@/shared/config/firebase'
import { PasswordInput } from '@/shared/ui'
import { mapAuthError } from '@/entities/auth'

type Mode = 'login' | 'register' | 'reset'

const COPY: Record<Mode, { title: string; subtitle: string; submit: string }> = {
  login: {
    title: 'Bem-vindo!',
    subtitle: 'Entre com sua conta para acessar o sistema',
    submit: 'Entrar',
  },
  register: {
    title: 'Criar conta',
    subtitle: 'Preencha os dados para criar sua conta',
    submit: 'Criar conta',
  },
  reset: {
    title: 'Redefinir senha',
    subtitle: 'Informe seu e-mail e enviaremos um link de redefinição',
    submit: 'Enviar link',
  },
}

export function LoginForm() {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [resetSent, setResetSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const isLogin = mode === 'login'
  const isReset = mode === 'reset'

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
    setResetSent(false)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!firebaseAuth) return
    setError(null)
    setLoading(true)
    try {
      if (isReset) {
        try {
          await sendPasswordResetEmail(firebaseAuth, email)
        } catch (err) {
          // Não revelamos se o e-mail existe: user-not-found recebe a mesma confirmação.
          if ((err as { code?: string }).code !== 'auth/user-not-found') throw err
        }
        setResetSent(true)
      } else if (isLogin) {
        await signInWithEmailAndPassword(firebaseAuth, email, password)
      } else {
        await createUserWithEmailAndPassword(firebaseAuth, email, password)
      }
      // Redirecionamento é feito pela LoginPage quando o status vira 'authenticated'.
    } catch (err) {
      setError(mapAuthError((err as { code?: string }).code ?? ''))
    } finally {
      setLoading(false)
    }
  }

  if (!hasFirebaseConfig) {
    return (
      <p className="max-w-sm rounded-lg border border-border bg-card p-4 text-sm text-muted">
        Login indisponível: configure as variáveis <code>VITE_FIREBASE_*</code> em{' '}
        <code>apps/client/.env</code>.
      </p>
    )
  }

  return (
    <div className="w-full max-w-md">
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-ink">{COPY[mode].title}</h1>
        <p className="mt-2 text-muted">{COPY[mode].subtitle}</p>
      </div>

      {isReset && resetSent ? (
        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 text-center">
          <p className="text-sm text-ink">
            Se o e-mail <strong>{email}</strong> estiver cadastrado, você receberá um link para
            redefinir sua senha. Confira também a caixa de spam.
          </p>
          <button
            type="button"
            onClick={() => switchMode('login')}
            className="text-center text-sm text-accent hover:underline"
          >
            ← Voltar para o login
          </button>
        </div>
      ) : (
        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6"
        >
          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex flex-col gap-2">
            <label htmlFor="email" className="text-sm font-medium text-ink">
              Email
            </label>
            <div className="relative">
              <Mail
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
                aria-hidden="true"
              />
              <input
                id="email"
                type="email"
                required
                placeholder="seu@email.com"
                value={email}
                autoComplete="email"
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface py-2.5 pl-10 pr-4 text-ink placeholder:text-muted"
              />
            </div>
          </div>

          {!isReset && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="text-sm font-medium text-ink">
                  Senha
                </label>
                {isLogin && (
                  <button
                    type="button"
                    onClick={() => switchMode('reset')}
                    className="text-sm text-accent hover:underline"
                  >
                    Esqueci minha senha
                  </button>
                )}
              </div>
              <div className="relative">
                <Lock
                  className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted"
                  aria-hidden="true"
                />
                <PasswordInput
                  id="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  autoComplete={isLogin ? 'current-password' : 'new-password'}
                  onChange={(e) => setPassword(e.target.value)}
                  className="rounded-lg border border-border bg-surface py-2.5 pl-10 pr-10 text-ink placeholder:text-muted"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 w-full rounded-lg bg-brand px-5 py-2.5 font-bold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
          >
            {loading ? 'Aguarde…' : COPY[mode].submit}
          </button>

          {isReset ? (
            <button
              type="button"
              onClick={() => switchMode('login')}
              className="text-center text-sm text-accent hover:underline"
            >
              ← Voltar para o login
            </button>
          ) : (
            <button
              type="button"
              onClick={() => switchMode(isLogin ? 'register' : 'login')}
              className="text-center text-sm text-accent hover:underline"
            >
              {isLogin ? 'Não tem conta? Criar conta' : 'Já tem conta? Entrar'}
            </button>
          )}
        </form>
      )}
    </div>
  )
}
