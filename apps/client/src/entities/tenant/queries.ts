import { hashKey, queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { PublicTenant } from '@pilari/types'
import { fetchTenant, getMyTenant, updateMyTenant } from './api'
import { readInjectedTenant } from './lib/tenant-data'
import { applyThemeCss } from './lib/theme'

export const TENANT_KEY = ['tenant'] as const
const TENANT_HASH = hashKey(TENANT_KEY)

/**
 * Último polo conhecido: o embutido no index.html (lido uma vez, no carregamento) e, depois, o mais recente
 * vindo da API. Alimenta o initialData. Hoje o auth preserva a consulta do polo ao encerrar a sessão, então nada
 * a remove. Mas um clear() ou um removeQueries() feito sem esse cuidado, em qualquer lugar, a leva embora, e a
 * que o próximo render reconstrói precisa nascer com o polo. Sem isso, no dev (sem bloco embutido) o useTenant()
 * lançaria, e em produção ela voltaria com a marca de antes de uma troca.
 */
let conhecido: PublicTenant | null = typeof document === 'undefined' ? null : readInjectedTenant(document)

export const tenantQueryOptions = queryOptions({
  queryKey: TENANT_KEY,
  // Sem o bloco embutido (dev do Vite) ou depois de uma troca de marca, o polo vem da API e o tema
  // é aplicado aqui, fora do ciclo do React: o lint do projeto proíbe useEffect.
  queryFn: async (): Promise<PublicTenant> => {
    const t = await fetchTenant()
    applyThemeCss(document, t.themeCss)
    conhecido = t
    return t
  },
  initialData: () => conhecido ?? undefined,
  staleTime: Infinity,
})

/**
 * A consulta do polo no cache, ou undefined se algo a removeu. O gate a lê a cada render e a cada aviso do cache,
 * então é leitura direta pelo hash: o find() varreria todas as consultas do app.
 */
export function findTenantQuery(client: QueryClient) {
  return client.getQueryCache().get(TENANT_HASH)
}

export function useTenantQuery() {
  return useQuery(tenantQueryOptions)
}

/** O polo do endereço. Só use abaixo do TenantGate, que garante o dado. */
export function useTenant(): PublicTenant {
  const { data } = useTenantQuery()
  if (!data) throw new Error('useTenant usado fora do TenantGate')
  return data
}

/** Configurações do próprio polo (Minha escola). Fora do prefixo 'tenant': cai junto com a sessão. */
export const MY_TENANT_KEY = ['admin', 'my-tenant'] as const

export function useMyTenantQuery() {
  return useQuery({ queryKey: MY_TENANT_KEY, queryFn: getMyTenant })
}

export function useUpdateMyTenantMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: updateMyTenant,
    onSuccess: (data) => {
      qc.setQueryData(MY_TENANT_KEY, data)
      // Cabeçalho, rodapé e tema leem o polo desta consulta: a marca nova aparece na hora. Invalidar (e não só
      // setQueryData) faz o queryFn rodar de novo, que é onde o tema é aplicado e o último polo conhecido é guardado.
      void qc.invalidateQueries({ queryKey: TENANT_KEY })
    },
  })
}
