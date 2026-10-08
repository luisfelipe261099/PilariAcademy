import { Navigate, useLocation } from 'react-router-dom'
import { useMeQuery } from '@/entities/auth'
import { postLoginTarget } from './role-routing'
import { RouteLoader } from './RouteLoader'

/** Só aceita caminho interno relativo — barra `//evil.com` e `https://evil.com` (open redirect). */
function safeInternalPath(value: string | undefined): string | undefined {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : undefined
}

/** Redireciona o usuário autenticado. Honra `state.from` (ex.: voltar ao carrinho); senão, destino do papel. */
export function RoleRedirect() {
  const location = useLocation()
  const from = safeInternalPath((location.state as { from?: string } | null)?.from)
  const { data, isPending, isError } = useMeQuery()
  if (from) return <Navigate to={from} replace />
  const target = postLoginTarget({
    profilePending: isPending,
    profileError: isError,
    roles: data?.roles ?? [],
  })
  if (!target) return <RouteLoader />
  return <Navigate to={target} replace />
}
