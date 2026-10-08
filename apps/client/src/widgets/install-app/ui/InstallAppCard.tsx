import { useState } from 'react'
import { Share, X } from 'lucide-react'
import { useTenant } from '@/entities/tenant'
import { conviteDoApp, instalarApp, useSituacaoDoApp } from '@/shared/lib/pwa'

const CHAVE = 'convite-app-dispensado'

function lerDispensado(): boolean {
  try {
    return localStorage.getItem(CHAVE) === '1'
  } catch {
    return false
  }
}

/**
 * Convite na área do aluno para usar o site como app. No Chrome/Android/computador, o botão abre o diálogo do
 * navegador; no iPhone, que não tem esse diálogo, ensina o caminho pelo Compartilhar do Safari.
 */
export function InstallAppCard() {
  const tenant = useTenant()
  const situacao = useSituacaoDoApp()
  const [dispensado, setDispensado] = useState(lerDispensado)
  const convite = conviteDoApp(situacao, dispensado)
  if (!convite) return null

  const dispensar = () => {
    setDispensado(true)
    try {
      localStorage.setItem(CHAVE, '1')
    } catch {
      // sem armazenamento: o convite volta na próxima visita
    }
  }
  const nome = tenant.isMatriz ? 'Studio Pilari' : tenant.name

  return (
    <section aria-label="Instalar o app" className="relative mt-6 flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 pr-12 sm:flex-row sm:items-center">
      <img src="/api/tenant/app-icon/any-192" alt="" width={56} height={56} className="size-14 shrink-0 rounded-2xl" />
      <div className="min-w-0 flex-1">
        <p className="font-bold text-ink">Estude pelo app no celular</p>
        {convite === 'botao' ? (
          <p className="mt-1 text-sm text-muted">Instale o app {nome}: ele fica na tela inicial, abre direto nos seus cursos e em tela cheia. Sem loja de aplicativos.</p>
        ) : (
          <p className="mt-1 text-sm text-muted">
            No Safari, toque em <Share className="inline size-4 align-text-bottom" aria-label="Compartilhar" /> Compartilhar e depois em{' '}
            <strong className="text-ink">Adicionar à Tela de Início</strong>. O app {nome} fica na sua tela inicial.
          </p>
        )}
      </div>
      {convite === 'botao' && (
        <button
          type="button"
          onClick={() => void instalarApp()}
          className="self-start rounded-full bg-brand px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-dark sm:self-center"
        >
          Instalar app
        </button>
      )}
      <button
        type="button"
        onClick={dispensar}
        aria-label="Agora não"
        title="Agora não"
        className="absolute top-3 right-3 inline-flex size-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-brand-soft hover:text-ink"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </section>
  )
}
