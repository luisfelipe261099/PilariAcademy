import { useSyncExternalStore } from 'react'
import { abertoComoApp, ehIos, type SituacaoDoApp } from './plataforma'

/** O evento `beforeinstallprompt` (Chrome, Edge, Android), que ainda não está nos tipos do DOM. */
interface PedidoDeInstalacao extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let pedido: PedidoDeInstalacao | null = null
let situacao: SituacaoDoApp = { podeInstalar: false, instalado: false, ios: false }
const ouvintes = new Set<() => void>()

function atualizar(parcial: Partial<SituacaoDoApp>): void {
  situacao = { ...situacao, ...parcial }
  for (const avisar of ouvintes) avisar()
}

/**
 * Chamado uma vez no main.tsx, antes do React: o `beforeinstallprompt` dispara cedo e uma vez por página, então o
 * ouvinte precisa existir desde o começo. Também registra o service worker (só no build de produção).
 */
export function iniciarApp(): void {
  const standalone = window.matchMedia('(display-mode: standalone)')
  atualizar({
    instalado: abertoComoApp(standalone.matches, (navigator as Navigator & { standalone?: boolean }).standalone),
    ios: ehIos(navigator.userAgent, navigator.maxTouchPoints ?? 0),
  })
  standalone.addEventListener('change', (e) => atualizar({ instalado: e.matches }))
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // o convite fica com o nosso botão, não com a barra do navegador
    pedido = e as PedidoDeInstalacao
    atualizar({ podeInstalar: true })
  })
  window.addEventListener('appinstalled', () => {
    pedido = null
    atualizar({ podeInstalar: false, instalado: true })
  })
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    const registrar = () => void navigator.serviceWorker.register('/sw.js').catch(() => undefined)
    if (document.readyState === 'complete') registrar()
    else window.addEventListener('load', registrar, { once: true })
  }
}

/** Abre o diálogo de instalação do navegador. `true` se a pessoa aceitou. */
export async function instalarApp(): Promise<boolean> {
  const p = pedido
  if (!p) return false
  pedido = null // o mesmo pedido não pode ser usado duas vezes
  atualizar({ podeInstalar: false })
  await p.prompt()
  const { outcome } = await p.userChoice
  return outcome === 'accepted'
}

function assinar(avisar: () => void): () => void {
  ouvintes.add(avisar)
  return () => ouvintes.delete(avisar)
}

export function useSituacaoDoApp(): SituacaoDoApp {
  return useSyncExternalStore(assinar, () => situacao, () => situacao)
}
