import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import type { PublicTenant } from '@pilari/types'
import { queryClient as queryClientDoApp } from '@/shared/api/query-client'

const POLO: PublicTenant = {
  slug: 'polo-a',
  name: 'Polo A',
  isMatriz: false,
  status: 'active',
  salesEnabled: false,
  branding: {
    logoUrl: null,
    logoLightUrl: null,
    faviconUrl: null,
    primaryColor: '#0055aa',
    accentColor: '#e8590c',
    whatsapp: null,
    phone: null,
    email: null,
    address: null,
    description: null,
    heroTitle: null,
    heroSubtitle: null,
  },
  themeCss: ':root{--color-brand:#0055aa}',
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** Cliente com os padrões reais do app (staleTime de 30 s, retry 1): é contra eles que o staleTime: Infinity do polo faz diferença. */
const novoCliente = () => new QueryClient({ defaultOptions: queryClientDoApp.getDefaultOptions() })

const desmontar: Array<() => void> = []

/**
 * Carrega queries.ts do zero (o último polo conhecido vive no módulo), com a API falsa e um document falso.
 * `embutido` simula o bloco tenant-data que o servidor põe no index.html; sem ele é o dev do Vite.
 */
async function carrega(embutido?: PublicTenant) {
  vi.resetModules()
  const fetchTenant = vi.fn(async () => POLO)
  vi.doMock('./api', () => ({ fetchTenant }))
  vi.stubGlobal('document', {
    getElementById: (id: string) => (id === 'tenant-data' && embutido ? { textContent: JSON.stringify(embutido) } : null),
    createElement: () => ({ id: '', textContent: null as string | null }),
    head: { appendChild: () => {} },
  })
  const mod = await import('./queries')
  /**
   * Monta um observer de verdade, assinado, como o useQuery de um componente. Um observer que só é criado nunca
   * busca nada: um teste de "sem requisição" feito com ele passa mesmo que a consulta nasça velha.
   */
  const monta = (client: QueryClient) => {
    const observer = new QueryObserver(client, mod.tenantQueryOptions)
    desmontar.push(observer.subscribe(() => {}))
    return observer
  }
  return { ...mod, fetchTenant, monta }
}

afterEach(() => {
  desmontar.splice(0).forEach((desmonta) => desmonta())
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.doUnmock('./api')
  vi.resetModules()
})

// Hoje o auth preserva a consulta do polo ao encerrar a sessão, então nada a remove. Mas um clear() ou um
// removeQueries() feito sem esse cuidado, em qualquer lugar, ainda a leva embora, e quem renderiza depois
// monta uma consulta nova no cache (é o que o useQuery faz com um observer novo). Ela precisa nascer com o
// polo e fresca: sem o polo, no dev (sem bloco embutido) o useTenant() lança; velha, ele seria buscado de novo.
describe('consulta do polo diante de uma remoção do cache', () => {
  it('no dev, renasce com o último polo buscado e nenhum observer montado a refaz', async () => {
    const { tenantQueryOptions, fetchTenant, monta } = await carrega()
    vi.useFakeTimers({ toFake: ['Date'] })
    const client = novoCliente()
    await client.fetchQuery(tenantQueryOptions)
    expect(fetchTenant).toHaveBeenCalledTimes(1)

    client.clear()

    monta(client) // o gate monta de novo: se o dado nascesse velho, é aqui que ele buscaria
    await tick()
    vi.setSystemTime(Date.now() + 60_000) // bem mais que os 30 s de staleTime padrão do app
    const tardio = monta(client) // outro componente monta um minuto depois
    await tick()

    expect(tardio.getCurrentResult().data).toEqual(POLO)
    expect(tardio.getCurrentResult().isStale).toBe(false)
    expect(fetchTenant).toHaveBeenCalledTimes(1)
  })

  it('em produção, renasce com o polo embutido e nenhum observer montado busca nada', async () => {
    const { fetchTenant, monta } = await carrega(POLO)
    vi.useFakeTimers({ toFake: ['Date'] })
    const client = novoCliente()
    monta(client) // o gate abre com o polo embutido
    await tick()
    expect(fetchTenant).not.toHaveBeenCalled()

    client.clear()

    monta(client)
    await tick()
    vi.setSystemTime(Date.now() + 60_000) // bem mais que os 30 s de staleTime padrão do app
    const tardio = monta(client)
    await tick()

    expect(tardio.getCurrentResult().data).toEqual(POLO)
    expect(tardio.getCurrentResult().isStale).toBe(false)
    expect(fetchTenant).not.toHaveBeenCalled()
  })

  it('renasce com o polo MAIS RECENTE, não com o embutido, depois de uma troca de marca', async () => {
    const { tenantQueryOptions, fetchTenant, monta } = await carrega({ ...POLO, name: 'Nome antigo' })
    const client = new QueryClient()
    monta(client) // o gate montado: só consulta com observer ativo é refeita
    fetchTenant.mockResolvedValueOnce({ ...POLO, name: 'Nome novo' })
    await client.invalidateQueries({ queryKey: ['tenant'] }) // o que a Minha escola faz ao salvar a marca
    desmontar.splice(0).forEach((desmonta) => desmonta())

    client.clear()

    expect(new QueryObserver(client, tenantQueryOptions).getCurrentResult().data?.name).toBe('Nome novo')
  })
})

describe('findTenantQuery', () => {
  it('acha a consulta e volta a undefined quando ela sai do cache, que é o sinal para o gate', async () => {
    const { tenantQueryOptions, findTenantQuery } = await carrega(POLO)
    const client = new QueryClient()
    expect(findTenantQuery(client)).toBeUndefined()
    const observer = new QueryObserver(client, tenantQueryOptions) // constrói a consulta no cache
    expect(findTenantQuery(client)).toBe(observer.getCurrentQuery())

    client.clear()

    expect(findTenantQuery(client)).toBeUndefined()
  })

  it('lê o mapa do cache direto, sem varrer as consultas (o gate a chama a cada render)', async () => {
    const { tenantQueryOptions, findTenantQuery } = await carrega(POLO)
    const client = new QueryClient()
    for (let i = 0; i < 100; i++) client.setQueryData(['outra', i], i) // um cache cheio, como o do app em uso
    const observer = new QueryObserver(client, tenantQueryOptions)
    const varreduras = vi.spyOn(client.getQueryCache(), 'getAll') // find() e findAll() passam por aqui

    expect(findTenantQuery(client)).toBe(observer.getCurrentQuery())
    expect(varreduras).not.toHaveBeenCalled()
  })
})
