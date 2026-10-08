import { hashKey, notifyManager, type QueryClient, type QueryKey } from '@tanstack/react-query'

/**
 * Avisa `onChange` quando a consulta de `queryKey` entra no cache do TanStack ou sai dele (add e remove, que é o que
 * clear() e removeQueries() fazem), para o gate poder renderizar de novo e se ligar à consulta nova. Devolve a função
 * que cancela a assinatura.
 *
 * O cache chama os ouvintes de forma síncrona, dentro do próprio add() e do remove(). E o add() acontece no render: é
 * o useQuery que reconstrói, no getOptimisticResult, a consulta que faltava. Um ouvinte cru que atualiza estado do
 * React ali dispara "Cannot update a component while rendering a different component". Por isso o aviso passa pelo
 * notifyManager.batchCalls, como o useIsFetching do próprio TanStack: sai do render e chega depois, em lote. O filtro
 * por entrada e saída da consulta é só leitura e roda na hora; só o aviso é adiado.
 */
export function watchQueryPresence(client: QueryClient, queryKey: QueryKey, onChange: () => void): () => void {
  const hash = hashKey(queryKey)
  const avisa = notifyManager.batchCalls(onChange)
  return client.getQueryCache().subscribe((event) => {
    if ((event.type === 'added' || event.type === 'removed') && event.query.queryHash === hash) avisa()
  })
}
