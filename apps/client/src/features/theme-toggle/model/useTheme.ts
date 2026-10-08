import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'pilari-theme'

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  // Exceção legada à regra "sem useEffect" (código da landing, anterior ao ciclo de auth).
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  function toggle() {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  }

  return { theme, setTheme, toggle }
}
