import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/** Rola para o topo a cada mudança de rota. */
export function ScrollToTop() {
  const { pathname } = useLocation()

  // Exceção legada à regra "sem useEffect" (código da landing, anterior ao ciclo de auth).
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return null
}
