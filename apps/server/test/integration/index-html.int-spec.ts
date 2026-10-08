import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootTestApp, type TestApp } from './helpers/app'
import { createTestDatabase, type TestDatabase } from './helpers/db'
import { bearer, seedTenant, seedTwoPolos, type TwoPolos } from './helpers/seed'

const INDEX = readFileSync(join(__dirname, '../../../client/index.html'), 'utf-8')
const dadosDe = (html: string) => JSON.parse(html.match(/id="tenant-data">([\s\S]*?)<\/script>/)![1])

describe('index.html por polo', () => {
  let t: TestDatabase
  let app: TestApp
  let w: TwoPolos
  let clientDir: string

  beforeAll(async () => {
    // Pasta de estáticos de mentira, como o public/ do container: o index.html cru (marca da
    // matriz), um asset com hash no nome e um arquivo solto.
    clientDir = mkdtempSync(join(tmpdir(), 'ead-client-'))
    mkdirSync(join(clientDir, 'assets'))
    writeFileSync(join(clientDir, 'index.html'), INDEX)
    writeFileSync(join(clientDir, 'assets', 'index-abc123.js'), 'console.log("bundle")')
    writeFileSync(join(clientDir, 'robots.txt'), 'User-agent: *\n')
    t = await createTestDatabase()
    app = await bootTestApp(t.url, { indexHtml: INDEX, clientDir })
    w = await seedTwoPolos(t)
  })
  afterAll(async () => {
    try {
      await app?.close()
    } finally {
      await t?.drop()
    }
  })
  afterAll(() => {
    if (clientDir) rmSync(clientDir, { recursive: true, force: true })
  })

  it('o polo recebe nome, tema e dados, sem a marca da matriz', async () => {
    const r = await app.http().get('/curso/excel-basico').set('Host', w.a.host)
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toContain('text/html')
    expect(r.headers['cache-control']).toBe('no-cache')
    expect(r.text).toContain('<title>Cursos | Polo A</title>')
    expect(r.text).toContain('<style id="tenant-theme">')
    expect(r.text).not.toContain('/brand/favicon.svg')
    expect(dadosDe(r.text)).toMatchObject({ slug: 'polo-a', salesEnabled: false })
  })

  it('cada polo recebe a própria página: nada do A aparece no B', async () => {
    const r = await app.http().get('/').set('Host', w.b.host)
    expect(r.status).toBe(200)
    expect(r.text).toContain('<title>Cursos | Polo B</title>')
    expect(r.text).not.toContain('Polo A')
    expect(dadosDe(r.text)).toMatchObject({ slug: 'polo-b', name: 'Polo B' })
  })

  it('a matriz continua com o HTML do build', async () => {
    const r = await app.http().get('/').set('Host', w.matriz.host)
    expect(r.text).toContain('<title>Cursos | Studio Pilari</title>')
    expect(r.text).toContain('/brand/favicon.svg')
    expect(r.text).not.toContain('tenant-theme')
    expect(dadosDe(r.text)).toMatchObject({ isMatriz: true })
  })

  it('a mudança de marca aparece no próximo carregamento', async () => {
    const antes = await app.http().get('/').set('Host', w.a.host)
    expect(dadosDe(antes.text).branding.heroTitle).toBeNull()
    const salvo = await app
      .http()
      .patch('/api/admin/tenant')
      .set('Host', w.a.host)
      .set('Authorization', bearer(w.u.adminA))
      .send({ branding: { heroTitle: 'Novo título do polo', primaryColor: '#112233' } })
    expect(salvo.status).toBe(200)
    const r = await app.http().get('/').set('Host', w.a.host)
    expect(dadosDe(r.text).branding.heroTitle).toBe('Novo título do polo')
    expect(r.text).toContain('--color-brand:#112233')
    // A marca do A não vaza para o B.
    const b = await app.http().get('/').set('Host', w.b.host)
    expect(dadosDe(b.text).branding.heroTitle).toBeNull()
    expect(b.text).not.toContain('--color-brand:#112233')
  })

  it('nome de polo com HTML dentro não quebra a página nem abre script', async () => {
    const nome = '</title><script>window.invadido=1</script> "x" & $&'
    const hostil = await seedTenant(t, { slug: 'polo-hostil', name: nome })
    const r = await app.http().get('/').set('Host', hostil.host)
    expect(r.status).toBe(200)
    expect(r.text).not.toContain('<script>window.invadido')
    expect(r.text).toContain('<title>Cursos | &lt;/title&gt;&lt;script&gt;window.invadido=1&lt;/script&gt; &quot;x&quot; &amp; $&amp;</title>')
    expect(dadosDe(r.text).name).toBe(nome)
  })

  it('o index.html cru, com a marca da matriz, nunca sai pelo endereço do polo', async () => {
    for (const caminho of ['/index.html', '//index.html', '/./index.html', '/assets/../index.html', '/%69ndex.html', '/index%2Ehtml', '/a%2F..%2Findex.html']) {
      const r = await app.http().get(caminho).set('Host', w.a.host)
      expect([caminho, r.status]).toEqual([caminho, 200])
      expect([caminho, r.text.includes('/brand/favicon.svg')]).toEqual([caminho, false])
      expect([caminho, r.text.includes('<title>Cursos | Polo A</title>')]).toEqual([caminho, true])
    }
  })

  it('os estáticos do client seguem servidos, com o cache de cada tipo', async () => {
    const asset = await app.http().get('/assets/index-abc123.js').set('Host', w.a.host)
    expect(asset.status).toBe(200)
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    expect(asset.text).toContain('bundle')
    const solto = await app.http().get('/robots.txt').set('Host', w.a.host)
    expect(solto.status).toBe(200)
    expect(solto.headers['cache-control']).toBe('no-cache')
    expect(solto.text).toContain('User-agent')
  })

  it('a API continua respondendo JSON, inclusive o 404 de rota que não existe', async () => {
    const r = await app.http().get('/api/courses').set('Host', w.a.host)
    expect(r.headers['content-type']).toContain('application/json')
    const nao = await app.http().get('/api/rota-que-nao-existe').set('Host', w.a.host)
    expect(nao.status).toBe(404)
    expect(nao.headers['content-type']).toContain('application/json')
  })
})
