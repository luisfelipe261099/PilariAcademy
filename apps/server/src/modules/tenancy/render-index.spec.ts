import type { PublicTenant } from '@pilari/types'
import { inlineScriptHashes } from '../../common/lib/csp'
import { EMPTY_BRANDING } from './branding'
import { INDEX_CACHE_CAP, IndexRenderer, initialFavicon, isIndexHtmlPath, jsonForHtml, renderIndexHtml } from './render-index'

/** Mesmo formato do index.html buildado pelo Vite. */
const BASE = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <script>
      ;(function () { document.documentElement.classList.add('x') })()
    </script>
    <link
      rel="icon"
      type="image/svg+xml"
      href="/brand/favicon.svg"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="manifest" href="/api/tenant/manifest" />
    <link rel="apple-touch-icon" href="/icons/pilari-apple-180.png" />
    <meta name="theme-color" content="#5c6e5a" />
    <meta name="apple-mobile-web-app-title" content="Studio Pilari" />
    <meta
      name="description"
      content="Cursos online de Pilates e fisioterapia com a Dra. Mylena Sestream, do Studio Pilari."
    />
    <title>Cursos | Studio Pilari</title>
    <script type="module" crossorigin src="/assets/index-abc.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-abc.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`

const polo = (over: Partial<PublicTenant> = {}): PublicTenant => ({
  slug: 'polo-a', name: 'Polo A', isMatriz: false, status: 'active', salesEnabled: false,
  branding: { ...EMPTY_BRANDING, primaryColor: '#0055aa' }, themeCss: ':root{--color-brand:#0055aa}', ...over,
})
const matriz = (): PublicTenant => ({ ...polo(), slug: 'pilari', name: 'Studio Pilari', isMatriz: true, salesEnabled: true, themeCss: null })
const dadosDe = (html: string) => JSON.parse(html.match(/<script type="application\/json" id="tenant-data">([\s\S]*?)<\/script>/)![1])

describe('renderIndexHtml', () => {
  it('app (PWA) do polo: ícone do iPhone versionado, cor da barra e nome curto do polo; a matriz fica com o F', () => {
    const html = renderIndexHtml(BASE, { tenant: polo({ name: 'Rat Academy Cursos Livres' }), siteUrl: 'https://x', versao: '1759752000000' })
    expect(html).toContain('<link rel="apple-touch-icon" href="/api/tenant/app-icon/apple-180?v=1759752000000" />')
    expect(html).toContain('<meta name="theme-color" content="#0055aa" />')
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Rat Academy" />')
    expect(html).toContain('<link rel="manifest" href="/api/tenant/manifest" />')

    const daMatriz = renderIndexHtml(BASE, { tenant: matriz(), siteUrl: 'https://x', versao: '1' })
    expect(daMatriz).toContain('<link rel="apple-touch-icon" href="/icons/pilari-apple-180.png" />')
    expect(daMatriz).toContain('<meta name="apple-mobile-web-app-title" content="Studio Pilari" />')
  })

  it('polo troca título, descrição e favicon, sem a marca da matriz', () => {
    const html = renderIndexHtml(BASE, { tenant: polo(), siteUrl: 'https://polo-a.cursos.studiopilari.com.br' })
    expect(html).toContain('<title>Cursos | Polo A</title>')
    expect(html).toContain('content="Polo A: cursos online com certificado de conclusão."')
    expect(html).not.toContain('/brand/favicon.svg')
    expect(html).toContain('<link rel="icon" href="data:image/svg+xml,')
  })

  it('o tema do polo vem depois do CSS do app e antes de fechar o head', () => {
    const html = renderIndexHtml(BASE, { tenant: polo(), siteUrl: 'https://x' })
    const tema = html.indexOf('<style id="tenant-theme">')
    expect(tema).toBeGreaterThan(html.indexOf('/assets/index-abc.css'))
    expect(tema).toBeLessThan(html.indexOf('</head>'))
  })

  it('matriz mantém título, descrição e favicon do build e não recebe tema', () => {
    const html = renderIndexHtml(BASE, { tenant: matriz(), siteUrl: 'https://cursos.studiopilari.com.br' })
    expect(html).toContain('<title>Cursos | Studio Pilari</title>')
    expect(html).toContain('/brand/favicon.svg')
    expect(html).not.toContain('tenant-theme')
    expect(dadosDe(html)).toMatchObject({ isMatriz: true, salesEnabled: true })
  })

  it('o bloco de dados é JSON válido e não fecha o script; o título é escapado', () => {
    const t = polo({ name: 'Polo </script><script>alert(1)</script> $& $1' })
    const html = renderIndexHtml(BASE, { tenant: t, siteUrl: 'https://x' })
    expect(dadosDe(html).name).toBe(t.name)
    expect(html).not.toContain('<script>alert(1)')
    expect(html).toContain('<title>Cursos | Polo &lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt; $&amp; $1</title>')
  })

  it('og:image usa o endereço absoluto da logo', () => {
    const t = polo({ branding: { ...EMPTY_BRANDING, logoUrl: '/api/tenant/assets/logo?v=1' } })
    const html = renderIndexHtml(BASE, { tenant: t, siteUrl: 'https://polo-a.cursos.studiopilari.com.br' })
    expect(html).toContain('<meta property="og:image" content="https://polo-a.cursos.studiopilari.com.br/api/tenant/assets/logo?v=1" />')
  })

  it('favicon próprio do polo substitui o da matriz', () => {
    const t = polo({ branding: { ...EMPTY_BRANDING, faviconUrl: '/api/tenant/assets/favicon?v=2' } })
    expect(renderIndexHtml(BASE, { tenant: t, siteUrl: 'https://x' })).toContain('<link rel="icon" href="/api/tenant/assets/favicon?v=2" />')
  })

  it('logo externa fica como está em og:image, e sem logo não há og:image', () => {
    const externa = polo({ branding: { ...EMPTY_BRANDING, logoUrl: 'https://cdn.exemplo.com/logo.png?a=1&b=2' } })
    expect(renderIndexHtml(BASE, { tenant: externa, siteUrl: 'https://x' })).toContain('<meta property="og:image" content="https://cdn.exemplo.com/logo.png?a=1&amp;b=2" />')
    expect(renderIndexHtml(BASE, { tenant: polo(), siteUrl: 'https://x' })).not.toContain('og:image')
  })

  it('traz as tags og do polo, com o endereço do site em og:url', () => {
    const html = renderIndexHtml(BASE, { tenant: polo(), siteUrl: 'https://polo-a.cursos.studiopilari.com.br' })
    expect(html).toContain('<meta property="og:type" content="website" />')
    expect(html).toContain('<meta property="og:site_name" content="Polo A" />')
    expect(html).toContain('<meta property="og:title" content="Cursos | Polo A" />')
    expect(html).toContain('<meta property="og:url" content="https://polo-a.cursos.studiopilari.com.br" />')
  })

  it('descrição própria do polo vale para a meta e para og:description', () => {
    const t = polo({ branding: { ...EMPTY_BRANDING, description: 'Aprenda com a gente.' } })
    const html = renderIndexHtml(BASE, { tenant: t, siteUrl: 'https://x' })
    expect(html).toContain('<meta name="description" content="Aprenda com a gente." />')
    expect(html).toContain('<meta property="og:description" content="Aprenda com a gente." />')
    expect(html).not.toContain('reconhecido pelo MEC')
  })

  it('aspas, & e < no nome e na descrição viram entidades em título, meta e og', () => {
    const t = polo({ name: 'Escola "A" & <B>', branding: { ...EMPTY_BRANDING, description: 'Tudo "rápido" & <fácil>' } })
    const html = renderIndexHtml(BASE, { tenant: t, siteUrl: 'https://x' })
    expect(html).toContain('<title>Cursos | Escola &quot;A&quot; &amp; &lt;B&gt;</title>')
    expect(html).toContain('<meta name="description" content="Tudo &quot;rápido&quot; &amp; &lt;fácil&gt;" />')
    expect(html).toContain('<meta property="og:site_name" content="Escola &quot;A&quot; &amp; &lt;B&gt;" />')
    expect(html).toContain('<meta property="og:description" content="Tudo &quot;rápido&quot; &amp; &lt;fácil&gt;" />')
    expect(dadosDe(html).name).toBe('Escola "A" & <B>')
  })

  it('"$" do texto do polo nunca vira padrão do String.replace (título, descrição, favicon e bloco)', () => {
    const t = polo({
      name: "Polo $& $' $` $1",
      branding: { ...EMPTY_BRANDING, description: "Só $& e $' e $`", faviconUrl: 'https://x.test/f$&.png' },
    })
    const html = renderIndexHtml(BASE, { tenant: t, siteUrl: 'https://x' })
    expect(html).toContain("<title>Cursos | Polo $&amp; $&#39; $` $1</title>")
    expect(html).toContain('<meta name="description" content="Só $&amp; e $&#39; e $`" />')
    expect(html).toContain('<link rel="icon" href="https://x.test/f$&amp;.png" />')
    expect(dadosDe(html)).toMatchObject({ name: t.name, branding: { description: "Só $& e $' e $`" } })
    expect(html.match(/<\/head>/g)).toHaveLength(1)
  })

  it('não cria script executável novo: os hashes da CSP do build continuam cobrindo a página', () => {
    const hostil = polo({
      name: '</script><script>alert(1)</script>',
      branding: { ...EMPTY_BRANDING, description: '</script><script>alert(2)</script>', heroTitle: '<img src=x onerror=alert(3)>', address: '<!-- </script>' },
      themeCss: ':root{--x:1}</style><script>alert(4)</script><style>',
    })
    for (const tenant of [hostil, matriz()]) {
      const html = renderIndexHtml(BASE, { tenant, siteUrl: 'https://x' })
      const semDados = html.replace(/<script type="application\/json" id="tenant-data">[\s\S]*?<\/script>/, '')
      expect(semDados).not.toContain('tenant-data')
      expect(inlineScriptHashes(semDados)).toEqual(inlineScriptHashes(BASE))
    }
  })

  it('nome que começa com emoji e polo sem favicon não derrubam a página', () => {
    const html = renderIndexHtml(BASE, { tenant: polo({ name: '🎓 Escola Nova' }), siteUrl: 'https://x' })
    expect(html).toContain('<title>Cursos | 🎓 Escola Nova</title>')
    expect(html).toContain('<link rel="icon" href="data:image/svg+xml,')
  })

  it('HTML sem </head> ainda recebe as tags e o bloco de dados, sem perder o conteúdo', () => {
    const html = renderIndexHtml('<div id="root"></div>', { tenant: polo(), siteUrl: 'https://x' })
    expect(html).toContain('<div id="root"></div>')
    expect(html).toContain('<meta property="og:title" content="Cursos | Polo A" />')
    expect(dadosDe(html).slug).toBe('polo-a')
  })
})

describe('jsonForHtml', () => {
  it('escapa < e os separadores de linha', () => {
    expect(jsonForHtml({ a: '</script>\u2028' })).toBe('{"a":"\\u003c/script>\\u2028"}')
  })

  it('a saída não tem "<" nem separadores de linha crus e o JSON volta igual', () => {
    const v = { nome: '<!-- </script> \u2028 \u2029 "aspas" \\ $& é', n: [1, null, true], o: { '</x>': 1 } }
    const s = jsonForHtml(v)
    expect(s).not.toMatch(/[<\u2028\u2029]/)
    expect(JSON.parse(s)).toEqual(v)
  })
})

describe('initialFavicon', () => {
  it('desenha a inicial do polo na cor do polo', () => {
    const uri = initialFavicon('polo azul', '#0055aa')
    expect(uri.startsWith('data:image/svg+xml,')).toBe(true)
    expect(decodeURIComponent(uri)).toContain('>P</text>')
    expect(decodeURIComponent(uri)).toContain('fill="#0055aa"')
  })

  it('emoji ou pontuação no começo do nome não impedem a inicial (nem lançam URIError)', () => {
    expect(decodeURIComponent(initialFavicon('🎓 escola nova', '#0055aa'))).toContain('>E</text>')
    expect(decodeURIComponent(initialFavicon('  (centro) sul', '#0055aa'))).toContain('>C</text>')
    expect(decodeURIComponent(initialFavicon('7 Mares', '#0055aa'))).toContain('>7</text>')
    expect(() => initialFavicon('\uD83C', '#0055aa')).not.toThrow()
  })

  it('nome sem letra nem dígito usa P; cor fora do formato usa a roxa da matriz', () => {
    expect(decodeURIComponent(initialFavicon('--- !!!', '#0055aa'))).toContain('>P</text>')
    expect(decodeURIComponent(initialFavicon('', '#0055aa'))).toContain('>P</text>')
    expect(decodeURIComponent(initialFavicon('x', 'red"/><script>'))).toContain('fill="#5c6e5a"')
  })
})

describe('isIndexHtmlPath', () => {
  it.each(['/index.html', '//index.html', '/./index.html', '/a/../index.html', '/%69ndex.html', '/index%2Ehtml', '/a%2F..%2Findex.html', '/INDEX.HTML'])(
    '%s é o index.html cru',
    (p) => expect(isIndexHtmlPath(p)).toBe(true)
  )

  it.each(['/', '/curso/index.html', '/assets/index-abc.js', '/index.html/', '/index.htm', '/%E0%A4%A', '/index.html%00'])(
    '%s não é',
    (p) => expect(isIndexHtmlPath(p)).toBe(false)
  )
})

describe('IndexRenderer', () => {
  const ctx = (updatedAt: Date) => ({
    id: 't-a', slug: 'polo-a', name: 'Polo A', isMatriz: false, status: 'active' as const, branding: { ...EMPTY_BRANDING }, updatedAt,
  })

  it('reaproveita o HTML enquanto o polo não muda e refaz quando muda', () => {
    const siteUrl = jest.fn(() => 'https://polo-a.cursos.studiopilari.com.br')
    const r = new IndexRenderer(BASE, siteUrl)
    const d1 = new Date('2026-10-01T10:00:00Z')
    expect(r.render(ctx(d1))).toBe(r.render(ctx(d1)))
    expect(siteUrl).toHaveBeenCalledTimes(1)
    r.render(ctx(new Date('2026-10-01T11:00:00Z')))
    expect(siteUrl).toHaveBeenCalledTimes(2)
  })

  it('polos diferentes não dividem o HTML, mesmo com a mesma data de alteração', () => {
    const r = new IndexRenderer(BASE, (t) => `https://${t.slug}.cursos.studiopilari.com.br`)
    const quando = new Date('2026-10-01T10:00:00Z')
    const a = r.render(ctx(quando))
    const b = r.render({ ...ctx(quando), id: 't-b', slug: 'polo-b', name: 'Polo B' })
    expect(a).toContain('<title>Cursos | Polo A</title>')
    expect(b).toContain('<title>Cursos | Polo B</title>')
    expect(b).not.toContain('Polo A')
  })

  it('o cache tem teto: passado dele, esvazia e volta a renderizar', () => {
    const siteUrl = jest.fn(() => 'https://x')
    const r = new IndexRenderer(BASE, siteUrl)
    const versao = (i: number) => ctx(new Date(1_700_000_000_000 + i))
    for (let i = 0; i < INDEX_CACHE_CAP; i++) r.render(versao(i))
    expect(siteUrl).toHaveBeenCalledTimes(INDEX_CACHE_CAP)
    r.render(versao(0))
    expect(siteUrl).toHaveBeenCalledTimes(INDEX_CACHE_CAP)
    r.render(versao(INDEX_CACHE_CAP))
    r.render(versao(0))
    expect(siteUrl).toHaveBeenCalledTimes(INDEX_CACHE_CAP + 2)
  })
})
