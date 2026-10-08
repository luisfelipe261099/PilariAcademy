import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./api', () => ({ syncUserData: vi.fn(async () => ({ user: null, roles: [] })) }))

import { handleTokenChange, useAuthStore } from './model'
import { syncUserData } from './api'

const fakeUser = { getIdToken: vi.fn(async () => 'tok-123') } as unknown as Parameters<typeof handleTokenChange>[0]

beforeEach(() => {
  useAuthStore.setState({ firebaseUser: null, idToken: null, status: 'checking' })
  vi.clearAllMocks()
})

describe('handleTokenChange', () => {
  it('sem usuário -> status anon', async () => {
    await handleTokenChange(null)
    expect(useAuthStore.getState().status).toBe('anon')
    expect(useAuthStore.getState().idToken).toBeNull()
  })

  it('primeiro sign-in -> authenticated + chama syncUserData', async () => {
    await handleTokenChange(fakeUser)
    expect(useAuthStore.getState().status).toBe('authenticated')
    expect(useAuthStore.getState().idToken).toBe('tok-123')
    expect(syncUserData).toHaveBeenCalledTimes(1)
  })

  it('refresh de token (já autenticado) -> NÃO re-sincroniza', async () => {
    useAuthStore.setState({ status: 'authenticated' })
    await handleTokenChange(fakeUser)
    expect(syncUserData).not.toHaveBeenCalled()
    expect(useAuthStore.getState().idToken).toBe('tok-123')
  })
})
