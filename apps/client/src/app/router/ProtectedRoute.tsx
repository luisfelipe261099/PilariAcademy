import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/entities/auth'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status)
  if (status === 'anon') return <Navigate to="/login" replace />
  return <>{children}</>
}
