import { describe, expect, it } from 'vitest'
import { readInjectedTenant } from './tenant-data'

const doc = (texto: string | null) =>
  ({ getElementById: (id: string) => (id === 'tenant-data' && texto !== null ? { textContent: texto } : null) }) as unknown as Document

const polo = { slug: 'polo-a', name: 'Polo A', isMatriz: false, status: 'active', salesEnabled: false, branding: { whatsapp: null }, themeCss: null }

describe('readInjectedTenant', () => {
  it('lê o polo embutido pelo servidor', () => {
    expect(readInjectedTenant(doc(JSON.stringify(polo)))).toEqual(polo)
  })
  it('lê o JSON como o servidor o escapa dentro do HTML (< vira \\u003c)', () => {
    const texto = '{"slug":"polo-a","name":"Polo \\u003cA>","isMatriz":false,"status":"active","salesEnabled":false,"branding":{"whatsapp":null},"themeCss":null}'
    expect(texto).toContain('\\u003c') // o fixture realmente traz o escape, não o caractere
    expect(readInjectedTenant(doc(texto))?.name).toBe('Polo <A>')
  })
  it('sem o bloco (dev do Vite) devolve null', () => {
    expect(readInjectedTenant(doc(null))).toBeNull()
  })
  it('bloco corrompido ou incompleto devolve null', () => {
    expect(readInjectedTenant(doc('{nao é json'))).toBeNull()
    expect(readInjectedTenant(doc(JSON.stringify({ slug: 'x' })))).toBeNull()
    expect(readInjectedTenant(doc('null'))).toBeNull()
  })
})
