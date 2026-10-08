import { describe, expect, it } from 'vitest'
import { applyThemeCss } from './theme'

function fakeDoc(comEstilo = false) {
  const els: Record<string, { id: string; textContent: string | null }> = {}
  if (comEstilo) els['tenant-theme'] = { id: 'tenant-theme', textContent: ':root{--color-brand:#000000}' }
  let anexados = 0
  const doc = {
    getElementById: (id: string) => els[id] ?? null,
    createElement: () => ({ id: '', textContent: null as string | null }),
    head: { appendChild: (el: { id: string; textContent: string | null }) => { els[el.id] = el; anexados += 1 } },
  }
  return { doc: doc as unknown as Document, els, anexados: () => anexados }
}

describe('applyThemeCss', () => {
  it('cria o <style> do tema quando ainda não existe', () => {
    const f = fakeDoc()
    applyThemeCss(f.doc, ':root{--color-brand:#0055aa}')
    expect(f.els['tenant-theme'].textContent).toBe(':root{--color-brand:#0055aa}')
    expect(f.anexados()).toBe(1)
  })
  it('troca o conteúdo do <style> que o servidor embutiu, sem duplicar', () => {
    const f = fakeDoc(true)
    applyThemeCss(f.doc, ':root{--color-brand:#112233}')
    expect(f.els['tenant-theme'].textContent).toBe(':root{--color-brand:#112233}')
    expect(f.anexados()).toBe(0)
  })
  it('sem tema (matriz) esvazia o que houver', () => {
    const f = fakeDoc(true)
    applyThemeCss(f.doc, null)
    expect(f.els['tenant-theme'].textContent).toBe('')
  })
  it('sem tema e sem <style> prévio (matriz no dev do Vite) não cria nada', () => {
    const f = fakeDoc()
    applyThemeCss(f.doc, null)
    expect(f.els['tenant-theme']).toBeUndefined()
    expect(f.anexados()).toBe(0)
  })
})
