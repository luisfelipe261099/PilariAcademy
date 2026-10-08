import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({ syncUserData: vi.fn(async () => ({ user: null, roles: [] })) }))

import { queryClient } from '@/shared/api/query-client'
import { TENANT_KEY } from '@/entities/tenant/queries'
import { handleTokenChange, useAuthStore } from './model'

// O polo é do endereço, não da sessão. handleTokenChange(null) roda no logout e na primeira resposta
// anônima do Firebase, no boot: derruba o que é do usuário e deixa a consulta do polo onde está.
const POLO = { slug: 'polo-a', name: 'Polo A', isMatriz: false }

beforeEach(() => {
  queryClient.clear()
  useAuthStore.setState({ firebaseUser: null, idToken: null, status: 'checking' })
})

describe('handleTokenChange(null) e o cache de consultas', () => {
  it('derruba as consultas da sessão e mantém a do polo, a mesma consulta, sem refazê-la', async () => {
    queryClient.setQueryData(TENANT_KEY, POLO)
    queryClient.setQueryData(['auth', 'me'], { user: { uid: 'u1' }, roles: ['admin'] })
    queryClient.setQueryData(['admin', 'my-tenant'], {
      slug: 'polo-a',
      siteUrl: 'https://polo-a.example',
    })
    queryClient.setQueryData(['courses', 'mine'], [{ id: 'c1' }])
    const consultaDoPolo = queryClient.getQueryCache().find({ queryKey: TENANT_KEY })

    await handleTokenChange(null)

    expect(queryClient.getQueryData(TENANT_KEY)).toEqual(POLO)
    expect(queryClient.getQueryCache().find({ queryKey: TENANT_KEY })).toBe(consultaDoPolo)
    expect(queryClient.getQueryData(['auth', 'me'])).toBeUndefined()
    // "my-tenant" é dado do admin logado, não o polo do endereço: sai com a sessão.
    expect(queryClient.getQueryData(['admin', 'my-tenant'])).toBeUndefined()
    expect(queryClient.getQueryData(['courses', 'mine'])).toBeUndefined()
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1)
  })

  it('só a chave inteira do polo fica: outra chave que começa com "tenant" é da sessão e sai', async () => {
    queryClient.setQueryData(TENANT_KEY, POLO)
    queryClient.setQueryData(['tenant', 'platform'], [{ id: 't1' }])
    queryClient.setQueryData(['tenant-admin'], { slug: 'polo-a' })

    await handleTokenChange(null)

    expect(queryClient.getQueryData(TENANT_KEY)).toEqual(POLO)
    expect(queryClient.getQueryData(['tenant', 'platform'])).toBeUndefined()
    expect(queryClient.getQueryData(['tenant-admin'])).toBeUndefined()
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1)
  })

  it('continua limpando as mutações, como o clear() fazia', async () => {
    queryClient.getMutationCache().build(queryClient, { mutationFn: async () => 'ok' })
    expect(queryClient.getMutationCache().getAll()).toHaveLength(1)

    await handleTokenChange(null)

    expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
  })

  it('o estado de autenticação vira anon, como antes', async () => {
    await handleTokenChange(null)
    expect(useAuthStore.getState().status).toBe('anon')
  })
})
