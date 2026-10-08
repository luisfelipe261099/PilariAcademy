import { describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { watchQueryPresence } from './watch-query-presence'

const KEY = ['tenant'] as const
const opcoes = { queryKey: KEY, queryFn: async () => 'polo' }
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('watchQueryPresence', () => {
  it('o cache avisa um ouvinte cru de forma síncrona, dentro do add() e do remove(): é o que o gate evita', () => {
    const client = new QueryClient()
    const cru = vi.fn()
    client.getQueryCache().subscribe(cru)

    new QueryObserver(client, opcoes) // o useQuery reconstrói a consulta que falta dentro do render
    expect(cru).toHaveBeenCalledWith(expect.objectContaining({ type: 'added' }))

    cru.mockClear()
    client.clear()
    expect(cru).toHaveBeenCalledWith(expect.objectContaining({ type: 'removed' }))
  })

  it('avisa quando a consulta entra no cache e quando sai, só depois que a operação do cache terminou', async () => {
    const client = new QueryClient()
    const onChange = vi.fn()
    const cancela = watchQueryPresence(client, KEY, onChange)

    new QueryObserver(client, opcoes) // add()
    expect(onChange).not.toHaveBeenCalled() // nunca no meio do add(), que é onde o render do gate está
    await tick()
    expect(onChange).toHaveBeenCalledTimes(1)

    client.clear() // remove()
    expect(onChange).toHaveBeenCalledTimes(1)
    await tick()
    expect(onChange).toHaveBeenCalledTimes(2)
    cancela()
  })

  it('avisa quando a consulta removida é recriada: é o que religa o gate à consulta nova', async () => {
    const client = new QueryClient()
    const primeira = new QueryObserver(client, opcoes).getCurrentQuery()
    const onChange = vi.fn()
    const cancela = watchQueryPresence(client, KEY, onChange)

    client.clear()
    const segunda = new QueryObserver(client, opcoes).getCurrentQuery() // o render seguinte do gate a reconstrói

    expect(segunda).not.toBe(primeira)
    expect(onChange).not.toHaveBeenCalled() // nem a saída nem a volta chegam durante o render
    await tick()
    expect(onChange).toHaveBeenCalled()
    cancela()
  })

  it('ignora as outras consultas do cache', async () => {
    const client = new QueryClient()
    const onChange = vi.fn()
    const cancela = watchQueryPresence(client, KEY, onChange)

    client.setQueryData(['courses'], []) // entra
    client.removeQueries({ queryKey: ['courses'] }) // sai
    await tick()

    expect(onChange).not.toHaveBeenCalled()
    cancela()
  })

  it('ignora o que não é entrar nem sair: observer que liga e desliga, dado novo na mesma consulta', async () => {
    const client = new QueryClient()
    new QueryObserver(client, opcoes) // a consulta já existe antes de começar a observar
    const onChange = vi.fn()
    const cancela = watchQueryPresence(client, KEY, onChange)

    const desliga = new QueryObserver(client, opcoes).subscribe(() => {}) // observer ligando, a busca atualizando
    client.setQueryData(KEY, 'outro polo') // dado novo
    await tick()
    desliga() // observer saindo
    await tick()

    expect(onChange).not.toHaveBeenCalled()
    cancela()
  })

  it('quem cancelou não é mais avisado', async () => {
    const client = new QueryClient()
    new QueryObserver(client, opcoes)
    const onChange = vi.fn()
    const cancela = watchQueryPresence(client, KEY, onChange)

    cancela()
    client.clear()
    await tick()

    expect(onChange).not.toHaveBeenCalled()
  })
})
