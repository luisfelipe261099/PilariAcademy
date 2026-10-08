import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useTenant } from '@/entities/tenant'

/** Telas de venda (financeiro, cobranças, cupons) só no polo que vende online; fora dele volta para `fallback`. */
export function RequireSales({ children, fallback = '/admin' }: { children: ReactNode; fallback?: string }) {
  const { salesEnabled } = useTenant()
  return salesEnabled ? <>{children}</> : <Navigate to={fallback} replace />
}
