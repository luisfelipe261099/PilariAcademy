import { createHash } from 'node:crypto'
import { inlineScriptHashes } from './csp'

const sha = (s: string) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`

describe('inlineScriptHashes', () => {
  it('gera o hash CSP do script inline preservando os bytes exatos (sem trim)', () => {
    const js = "\n  ;(function () {\n    console.log('tema')\n  })()\n"
    expect(inlineScriptHashes(`<html><head><script>${js}</script></head></html>`)).toEqual([sha(js)])
  })

  it('ignora scripts externos (com src), com ou sem outros atributos', () => {
    const html = '<script src="/a.js"></script><script type="module" crossorigin src="/assets/b.js"></script>'
    expect(inlineScriptHashes(html)).toEqual([])
  })

  it('pega múltiplos scripts inline, inclusive com atributos (type="module")', () => {
    const html = '<script>a()</script><p>x</p><script type="module">b()</script>'
    expect(inlineScriptHashes(html)).toEqual([sha('a()'), sha('b()')])
  })

  it('HTML sem script inline → lista vazia', () => {
    expect(inlineScriptHashes('<html><body>oi</body></html>')).toEqual([])
  })
})
