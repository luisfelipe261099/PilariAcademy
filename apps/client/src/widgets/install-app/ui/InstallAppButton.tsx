import { Download } from 'lucide-react'
import { instalarApp, useSituacaoDoApp } from '@/shared/lib/pwa'

/** Atalho do cabeçalho: só aparece quando o navegador oferece a instalação (Chrome, Edge, Android). */
export function InstallAppButton() {
  const { podeInstalar, instalado } = useSituacaoDoApp()
  if (!podeInstalar || instalado) return null
  return (
    <button
      type="button"
      onClick={() => void instalarApp()}
      aria-label="Instalar o app"
      title="Instalar o app neste aparelho"
      className="inline-flex size-10 items-center justify-center gap-2 rounded-full border border-border text-accent transition-colors hover:bg-brand-soft lg:w-auto lg:px-4 lg:text-sm lg:font-medium"
    >
      <Download className="size-5 lg:size-4" aria-hidden="true" />
      <span className="hidden lg:inline">Instalar app</span>
    </button>
  )
}
