import { useAuthStore } from '@/entities/auth'
import { BrandLogo, useTenant } from '@/entities/tenant'
import { LoginForm } from '@/features/auth-login'
import { RoleRedirect } from '@/app/router/RoleRedirect'
import { loginTagline } from '@/shared/lib/brand-copy'

export function LoginPage() {
  const status = useAuthStore((s) => s.status)
  const tenant = useTenant()
  if (status === 'authenticated') return <RoleRedirect />

  return (
    <div className="grid min-h-dvh bg-bg lg:grid-cols-2">
      {/* ESQUERDA — marca (escondida no mobile) */}
      <aside className="relative hidden flex-col justify-center overflow-hidden p-12 lg:flex">
        {/* brilho rosa sutil no canto superior esquerdo */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(60% 55% at 0% 0%, color-mix(in srgb, var(--color-brand-bright) 22%, transparent), transparent 60%)',
          }}
        />

        <div className="relative z-10 max-w-md">
          <BrandLogo className="mb-10 h-12 w-auto" />
          <h2 className="text-4xl font-bold leading-tight text-ink">Cursos online</h2>
          <p className="mt-4 text-lg text-muted">{loginTagline(tenant.isMatriz)}</p>
        </div>
      </aside>

      {/* DIREITA — formulário */}
      <main className="flex flex-col items-center justify-center px-4 py-10 sm:px-8">
        {/* logo só no mobile (no desktop ela aparece no painel esquerdo) */}
        <div className="mb-8 lg:hidden">
          <BrandLogo className="h-10 w-auto" />
        </div>
        <LoginForm />
      </main>
    </div>
  )
}
