import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import type { Role } from '@pilari/types'
import { useAuthStore, useMeQuery } from '@/entities/auth'
import { roleAccessDecision } from './role-routing'
import { RouteLoader } from './RouteLoader'

/** Guard de papel (UX). O backend continua sendo a validação real. */
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const status = useAuthStore((s) => s.status)
  const { data, isPending, isError } = useMeQuery()
  const decision = roleAccessDecision(
    { status, profilePending: isPending, profileError: isError, roles: data?.roles ?? [] },
    role
  )
  if (decision === 'loading') return <RouteLoader />
  if (decision === 'redirect-login') return <Navigate to="/login" replace />
  if (decision === 'redirect-dashboard') return <Navigate to="/dashboard" replace />
  return <>{children}</>
}
