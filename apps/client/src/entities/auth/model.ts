import { create } from 'zustand'
import { hashKey } from '@tanstack/react-query'
import { onIdTokenChanged, type User } from 'firebase/auth'
import { firebaseAuth, hasFirebaseConfig } from '@/shared/config/firebase'
import { queryClient } from '@/shared/api/query-client'
// Direto de queries, não do barrel: o auth não deve puxar a UI do polo (e um ciclo auth -> ui -> auth).
import { TENANT_KEY } from '@/entities/tenant/queries'
import { syncUserData } from './api'

export type AuthStatus = 'checking' | 'anon' | 'authenticated'

interface AuthState {
  firebaseUser: User | null
  idToken: string | null
  status: AuthStatus
}

export const useAuthStore = create<AuthState>(() => ({
  firebaseUser: null,
  idToken: null,
  status: 'checking',
}))

/**
 * Descarta o que pertence à sessão que acabou: consultas e mutações, como o clear() fazia. A consulta
 * do polo fica: o polo é do endereço, não do usuário, e o TenantGate e o useTenant() dependem dela em
 * todo render. Roda no logout e na primeira resposta anônima do Firebase, no boot, que pode chegar no
 * meio da busca do polo. Fica só a chave inteira do polo: outra chave que apenas comece com "tenant"
 * é dado de sessão e sai.
 */
function clearSessionData(): void {
  const chaveDoPolo = hashKey(TENANT_KEY)
  queryClient.removeQueries({ predicate: (q) => q.queryHash !== chaveDoPolo })
  queryClient.getMutationCache().clear()
}

/** Transição de sessão (sem React) disparada pelo onIdTokenChanged. Exportada para teste. */
export async function handleTokenChange(user: User | null): Promise<void> {
  if (!user) {
    useAuthStore.setState({ firebaseUser: null, idToken: null, status: 'anon' })
    clearSessionData()
    return
  }
  const idToken = await user.getIdToken()
  const wasAuthenticated = useAuthStore.getState().status === 'authenticated'
  useAuthStore.setState({ firebaseUser: user, idToken, status: 'authenticated' })
  if (wasAuthenticated) return // refresh de token: não re-sincroniza nem dá splash
  try {
    const result = await syncUserData()
    queryClient.setQueryData(['auth', 'me'], result)
  } catch {
    // erro tratado no /dashboard via useMeQuery (refetch)
  }
}

if (hasFirebaseConfig && firebaseAuth) {
  onIdTokenChanged(firebaseAuth, (user) => void handleTokenChange(user))
} else {
  useAuthStore.setState({ status: 'anon' })
}
