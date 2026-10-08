import { useCallback, useSyncExternalStore, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { TENANT_KEY, findTenantQuery, useTenantQuery } from '@/entities/tenant'
import { watchQueryPresence } from './watch-query-presence'

/**
 * Segura o app até conhecer o polo do endereço, como o SessionGate faz com a sessão. Em produção o
 * polo já vem no HTML e a passagem é imediata: o site nunca pinta a marca da matriz num polo.
 */
export function TenantGate({ children }: { children: ReactNode }) {
  const { data, isError, isFetching, refetch } = useTenantQuery()

  // Defesa. Hoje o auth preserva a consulta do polo ao encerrar a sessão, então nada a remove. Se um clear() ou um
  // removeQueries() futuro a levar embora no meio da primeira busca (dev, sem bloco embutido), o observer do gate
  // fica preso à consulta destruída: não é mais avisado e o "Carregando…" nunca sai. Assinar a presença da consulta
  // no cache faz o gate renderizar de novo e se ligar à consulta nova. O aviso chega em lote, fora do render (ver
  // watchQueryPresence). Vem depois do useTenantQuery para a consulta já existir na primeira leitura.
  const client = useQueryClient()
  const assinaCache = useCallback((avisa: () => void) => watchQueryPresence(client, TENANT_KEY, avisa), [client])
  useSyncExternalStore(assinaCache, () => findTenantQuery(client))

  if (data) return <>{children}</>
  if (isError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-muted">
        <p>Não foi possível carregar o site.</p>
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="rounded-full border border-border px-4 py-2 text-sm font-medium text-ink disabled:opacity-60"
        >
          Tentar de novo
        </button>
      </div>
    )
  }
  return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Carregando…</div>
}
