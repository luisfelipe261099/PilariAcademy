import { useSyncExternalStore } from 'react'

/**
 * Assina uma media query de forma reativa (atualiza ao redimensionar / trocar de device
 * no DevTools) sem useEffect — usa useSyncExternalStore, a forma correta de assinar
 * uma fonte externa (matchMedia).
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}
