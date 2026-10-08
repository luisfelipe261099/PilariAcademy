import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../model/useTheme'

export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const isDark = theme === 'dark'

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'Ativar tema claro' : 'Ativar tema escuro'}
      aria-pressed={isDark}
      title={isDark ? 'Tema claro' : 'Tema escuro'}
      className="grid size-9 shrink-0 place-items-center rounded-full border border-border text-ink transition-colors hover:bg-surface"
    >
      {isDark ? <Sun className="size-4" aria-hidden="true" /> : <Moon className="size-4" aria-hidden="true" />}
    </button>
  )
}
