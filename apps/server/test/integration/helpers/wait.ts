/** O audit log é gravado em segundo plano; espera a condição por até `timeoutMs`. */
export async function eventually<T>(fn: () => Promise<T>, check: (v: T) => boolean, timeoutMs = 3000): Promise<T> {
  const fim = Date.now() + timeoutMs
  let ultimo = await fn()
  while (!check(ultimo)) {
    if (Date.now() > fim) return ultimo
    await new Promise((r) => setTimeout(r, 50))
    ultimo = await fn()
  }
  return ultimo
}
