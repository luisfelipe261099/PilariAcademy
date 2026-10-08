import type { ReactNode } from 'react'
import { useAuthStore } from '@/entities/auth'

export function SessionGate({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status)
  if (status === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Carregando…
      </div>
    )
  }
  return <>{children}</>
}
