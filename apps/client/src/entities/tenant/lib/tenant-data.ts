import type { PublicTenant } from '@pilari/types'

/** Polo embutido pelo servidor no index.html (bloco tenant-data). null no dev do Vite ou se o bloco vier corrompido. */
export function readInjectedTenant(doc: Pick<Document, 'getElementById'>): PublicTenant | null {
  const texto = doc.getElementById('tenant-data')?.textContent
  if (!texto) return null
  try {
    const t = JSON.parse(texto) as Partial<PublicTenant> | null
    const valido =
      !!t && typeof t.slug === 'string' && typeof t.name === 'string' && typeof t.isMatriz === 'boolean' &&
      typeof t.salesEnabled === 'boolean' && !!t.branding && typeof t.branding === 'object'
    return valido ? (t as PublicTenant) : null
  } catch {
    return null
  }
}
