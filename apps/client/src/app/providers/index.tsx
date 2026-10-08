import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/shared/api/query-client'
import { SessionGate } from './SessionGate'
import { TenantGate } from './TenantGate'
import '@/entities/auth' // registra o listener onIdTokenChanged no import

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <TenantGate>
        <SessionGate>{children}</SessionGate>
      </TenantGate>
    </QueryClientProvider>
  )
}
