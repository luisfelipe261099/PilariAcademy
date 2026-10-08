import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore, useMeQuery } from '@/entities/auth'
import { useTenant } from '@/entities/tenant'
import { platformAccessDecision } from './role-routing'
import { RouteLoader } from './RouteLoader'

/** Guard do console da plataforma (UX): só admin da plataforma, só no endereço da matriz. O backend é a validação real. */
export function RequirePlatformAdmin({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status)
  const { data, isPending, isError, refetch, isFetching } = useMeQuery()
  const tenant = useTenant()
  const decision = platformAccessDecision({
    status,
    profilePending: isPending,
    profileError: isError,
    isPlatformAdmin: data?.user?.isPlatformAdmin ?? false,
    isMatriz: tenant.isMatriz,
  })
  if (decision === 'loading') return <RouteLoader />
  if (decision === 'redirect-login') return <Navigate to="/login" replace />
  if (decision === 'redirect-admin') return <Navigate to="/admin" replace />
  if (decision === 'retry') {
    return (
      <div className="p-8 text-sm">
        <p className="text-ink">Não foi possível conferir o seu acesso agora.</p>
        <button type="button" onClick={() => void refetch()} disabled={isFetching} className="mt-3 rounded-full bg-brand px-4 py-2 font-bold text-white disabled:opacity-60">
          {isFetching ? 'Conferindo…' : 'Tentar de novo'}
        </button>
      </div>
    )
  }
  return <>{children}</>
}
