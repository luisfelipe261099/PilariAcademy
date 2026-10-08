import { Link } from 'react-router-dom'
import { UserCog } from 'lucide-react'
import { signOut } from 'firebase/auth'
import type { Enrollment } from '@pilari/types'
import { firebaseAuth } from '@/shared/config/firebase'
import { useMeQuery, syncUserData } from '@/entities/auth'
import { useMyEnrollmentsQuery } from '@/entities/enrollment'
import { queryClient } from '@/shared/api/query-client'
import { InstallAppCard } from '@/widgets/install-app'

function statusLabel(e: Enrollment): string {
  if (e.status === 'active') return 'Ativo'
  if (e.status === 'canceled') return 'Cancelado'
  return 'Pendente — aguardando confirmação do pagamento'
}

function MeusCursos() {
  const { data, isLoading, isError } = useMyEnrollmentsQuery()
  if (isLoading) return <p className="text-muted">Carregando seus cursos…</p>
  if (isError) return <p className="text-red-500">Não foi possível carregar seus cursos.</p>
  if (!data || data.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-surface px-6 py-12 text-center">
        <p className="text-lg font-bold text-ink">Você ainda não tem cursos</p>
        <p className="mt-1 text-muted">Explore o catálogo e comece a aprender.</p>
        <Link to="/#cursos" className="mt-5 inline-block rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-dark">
          Ver cursos
        </Link>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {data.map((e) => (
        <div key={e.id} className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card">
          <div className="aspect-[16/10] bg-brand-soft">
            {e.course.coverImageUrl && <img src={e.course.coverImageUrl} alt={e.course.title} style={{ objectPosition: e.course.coverFocus ?? '50% 100%' }} className="size-full object-cover" loading="lazy" />}
          </div>
          <div className="flex flex-1 flex-col p-4">
            {e.course.category && <span className="text-xs font-medium tracking-wide text-brand-bright uppercase">{e.course.category.name}</span>}
            <h3 className="mt-1 line-clamp-2 font-bold text-ink">{e.course.title}</h3>
            <span className={'mt-2 text-xs ' + (e.status === 'active' ? 'text-accent' : 'text-muted')}>{statusLabel(e)}</span>

            {e.status === 'active' && (
              <div className="mt-3">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-brand-soft">
                  <div className="h-full bg-brand" style={{ width: `${e.progressPercent}%` }} />
                </div>
                <span className="mt-1 block text-xs text-muted">{e.progressPercent}% concluído</span>
              </div>
            )}

            {e.status === 'active' ? (
              <>
                <Link
                  to={`/aprender/${e.course.slug}`}
                  className="mt-3 w-full rounded-full bg-brand px-4 py-2 text-center text-sm font-bold text-white transition-colors hover:bg-brand-dark"
                >
                  {e.progressPercent > 0 ? 'Continuar' : 'Começar curso'}
                </Link>
                {e.progressPercent === 100 && (
                  <Link
                    to={`/aprender/${e.course.slug}`}
                    className="mt-2 block w-full cursor-pointer rounded-full border border-brand px-4 py-2 text-center text-sm font-bold text-brand transition-colors hover:bg-brand-soft"
                  >
                    Emitir certificado
                  </Link>
                )}
              </>
            ) : (
              <button
                type="button"
                disabled
                className="mt-3 w-full rounded-full bg-brand px-4 py-2 text-sm font-bold text-white opacity-50"
                title="Disponível após a confirmação"
              >
                Aguardando
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export function DashboardPage() {
  const { data, isLoading, isError, refetch } = useMeQuery()

  async function handleRetry() {
    try {
      const result = await syncUserData()
      queryClient.setQueryData(['auth', 'me'], result)
    } catch {
      void refetch()
    }
  }

  if (isLoading) return <div className="p-8 text-muted-foreground">Carregando perfil…</div>

  if (isError || !data?.user) {
    return (
      <div className="flex flex-col items-start gap-3 p-8">
        <p className="text-red-500">Não foi possível carregar seu perfil.</p>
        <button type="button" onClick={() => void handleRetry()} className="rounded-full border border-border px-4 py-2 text-sm">
          Tentar de novo
        </button>
      </div>
    )
  }

  const { user } = data
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-ink">Meu aprendizado</h1>
          <p className="text-muted">Olá, {user.displayName ?? user.email}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
        {/* Entrada única para dados, financeiro, certificados e senha. Sem este link o
            aluno não teria como chegar na área — o header aponta para cá, não para lá. */}
        <Link
          to="/minha-conta"
          className="inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-dark"
        >
          <UserCog className="size-4" aria-hidden="true" /> Minha conta
        </Link>
        <button
          type="button"
          onClick={() => firebaseAuth && void signOut(firebaseAuth)}
          className="rounded-full border border-border px-4 py-2 text-sm transition-colors hover:bg-brand-soft"
        >
          Sair
        </button>
        </div>
      </div>

      <InstallAppCard />

      <section className="mt-8">
        <MeusCursos />
      </section>
    </div>
  )
}
