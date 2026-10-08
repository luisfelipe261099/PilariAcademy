import axios from 'axios'
import { signOut } from 'firebase/auth'
import { firebaseAuth } from '@/shared/config/firebase'

export const httpClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api',
})

httpClient.interceptors.request.use(async (config) => {
  const user = firebaseAuth?.currentUser
  if (user) {
    const token = await user.getIdToken()
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

httpClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config as (typeof error.config & { _retried?: boolean }) | undefined
    const user = firebaseAuth?.currentUser
    if (error.response?.status === 401 && user && original && !original._retried) {
      original._retried = true
      let fresh: string
      try {
        fresh = await user.getIdToken(true)
      } catch {
        // refresh falhou -> sessao morta: desloga e manda pro login
        if (firebaseAuth) await signOut(firebaseAuth)
        window.location.assign('/login')
        return Promise.reject(error)
      }
      original.headers.Authorization = `Bearer ${fresh}`
      return httpClient(original)
    }
    return Promise.reject(error)
  },
)
