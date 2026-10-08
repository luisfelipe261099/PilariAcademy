import { bootTestApp, type TestApp } from './helpers/app'
import { createTestDatabase, type TestDatabase } from './helpers/db'
import { bearer, seedTwoPolos, type TwoPolos } from './helpers/seed'
import { eventually } from './helpers/wait'

describe('marca do polo', () => {
  let t: TestDatabase
  let app: TestApp
  let w: TwoPolos

  beforeAll(async () => {
    t = await createTestDatabase()
    app = await bootTestApp(t.url)
    w = await seedTwoPolos(t)
  })
  afterAll(async () => {
    try {
      await app?.close()
    } finally {
      await t?.drop()
    }
  })

  const comoAdminA = () => ({ Host: w.a.host, Authorization: bearer(w.u.adminA) })

  it('GET /api/tenant devolve o polo do endereço', async () => {
    const a = await app.http().get('/api/tenant').set('Host', w.a.host)
    expect(a.status).toBe(200)
    expect(a.body).toMatchObject({ slug: 'polo-a', name: 'Polo A', isMatriz: false, salesEnabled: false })
    expect(a.body.themeCss).toContain('--color-brand:#0055aa')
    expect(a.body.branding.whatsapp).toBe('5541900000000')
    const m = await app.http().get('/api/tenant').set('Host', w.matriz.host)
    expect(m.body).toMatchObject({ isMatriz: true, salesEnabled: true, themeCss: null })
    expect(m.body.branding.whatsapp).toBe('5541997102441')
  })

  it('o admin lê as configurações do próprio polo', async () => {
    const r = await app.http().get('/api/admin/tenant').set(comoAdminA())
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({
      slug: 'polo-a', name: 'Polo A', siteUrl: 'https://polo-a.cursos.studiopilari.com.br', isMatriz: false, salesEnabled: false,
    })
    expect(r.body.branding).toMatchObject({ primaryColor: '#0055aa', accentColor: '#ff6600', whatsapp: '5541900000000', logoUrl: null })
    expect(r.body.publicBranding).toMatchObject({ primaryColor: '#0055aa', logoUrl: null })
  })

  it('a Minha escola lê o banco, não o cache do endereço (outra instância pode ter salvo antes)', async () => {
    // O endereço do A entra no cache do polo (60 s por instância)...
    expect((await app.http().get('/api/tenant').set('Host', w.a.host)).body.branding.heroSubtitle).toBeNull()
    // ...e "outra instância" grava a marca direto no banco, sem passar pelo TenantsService (que limparia o cache daqui).
    await t.pool.query("UPDATE tenants SET branding = JSON_SET(branding, '$.heroSubtitle', ?) WHERE id = ?", ['Salvo por outra instância', w.a.id])
    const r = await app.http().get('/api/admin/tenant').set(comoAdminA())
    expect(r.status).toBe(200)
    expect(r.body.branding.heroSubtitle).toBe('Salvo por outra instância')
  })

  it('o admin do polo altera a marca do próprio polo e só dele', async () => {
    const r = await app.http().patch('/api/admin/tenant').set(comoAdminA()).send({ branding: { heroTitle: 'Bem-vindo ao Polo A', primaryColor: '#112233' } })
    expect(r.status).toBe(200)
    expect(r.body.branding.heroTitle).toBe('Bem-vindo ao Polo A')
    expect((await app.http().get('/api/tenant').set('Host', w.a.host)).body.themeCss).toContain('--color-brand:#112233')
    expect((await app.http().get('/api/tenant').set('Host', w.b.host)).body.branding.heroTitle).toBeNull()
    const noB = await app.http().patch('/api/admin/tenant').set('Host', w.b.host).set('Authorization', bearer(w.u.adminA)).send({ branding: { heroTitle: 'x' } })
    expect(noB.status).toBe(403)
  })

  it('B7: o polo não grava "reconhecido pelo MEC" nem "certificado pelo MEC" na marca, e nada muda', async () => {
    const antes = (await app.http().get('/api/admin/tenant').set(comoAdminA())).body.branding
    const r = await app.http().patch('/api/admin/tenant').set(comoAdminA()).send({ branding: { heroSubtitle: 'Cursos RECONHECIDOS pelo  MEC', primaryColor: '#445566' } })
    expect([r.status, r.body.message]).toEqual([
      400, 'Use "Curso livre com certificado de conclusão" em vez de "reconhecidos pelo MEC".',
    ])
    expect((await app.http().get('/api/admin/tenant').set(comoAdminA())).body.branding).toEqual(antes)
  })

  it('a alteração fica na auditoria do polo, só com nomes de campo da marca', async () => {
    const r = await app.http().patch('/api/admin/tenant').set(comoAdminA()).send({ branding: { description: 'Descrição auditada', 'campo-inventado': 'x', [`inventado-${'x'.repeat(600)}`]: 'x' } })
    expect(r.status).toBe(200)
    const linhas = await eventually(
      async () => (await t.pool.query("SELECT tenant_id, actor_uid, summary FROM audit_logs WHERE action = 'tenant.branding' AND summary LIKE '%description%'"))[0] as Array<{ tenant_id: string; actor_uid: string; summary: string }>,
      (v) => v.length > 0
    )
    expect(linhas).toEqual([{ tenant_id: w.a.id, actor_uid: w.u.adminA, summary: 'Alterou a marca do polo: description' }])
  })

  it('imagem de outro polo é recusada', async () => {
    const r = await app.http().patch('/api/admin/tenant').set(comoAdminA()).send({ branding: { logoUrl: `polos/${w.b.id}/marca/logo.png` } })
    expect(r.status).toBe(400)
  })

  it('o upload da marca aceita só PNG, JPEG e WebP, na pasta do polo', async () => {
    const svg = await app.http().post('/api/admin/tenant/upload-url').set(comoAdminA()).send({ kind: 'logo', fileName: 'logo.svg', contentType: 'image/svg+xml' })
    expect(svg.status).toBe(400)
    const ok = await app.http().post('/api/admin/tenant/upload-url').set(comoAdminA()).send({ kind: 'logo', fileName: '../logo final.png', contentType: 'image/png' })
    expect(ok.status).toBe(201)
    expect(ok.body.objectPath).toMatch(new RegExp(`^polos/${w.a.id}/marca/logo-`))
    expect(ok.body.objectPath).not.toContain('..')
  })

  it('a logo enviada é servida pelo endereço do polo e só por ele', async () => {
    const caminho = `polos/${w.a.id}/marca/logo-teste.png`
    app.fakes.gcs.objects.set(caminho, { buffer: Buffer.from('png'), contentType: 'image/png' })
    const salvo = await app.http().patch('/api/admin/tenant').set(comoAdminA()).send({ branding: { logoUrl: caminho } })
    expect(salvo.status).toBe(200)
    expect(salvo.body.branding.logoUrl).toBe(caminho)
    expect(salvo.body.publicBranding.logoUrl).toMatch(/^\/api\/tenant\/assets\/logo\?v=\d+$/)
    const publico = await app.http().get('/api/tenant').set('Host', w.a.host)
    expect(publico.body.branding.logoUrl).toMatch(/^\/api\/tenant\/assets\/logo\?v=\d+$/)
    const img = await app.http().get('/api/tenant/assets/logo').set('Host', w.a.host)
    expect(img.status).toBe(200)
    expect(img.headers['content-type']).toContain('image/png')
    // Cache de uma semana só para a URL que o site recebe (com a versão atual do polo); sem ela, ou com uma velha, um minuto.
    expect(img.headers['cache-control']).toBe('public, max-age=60')
    expect((await app.http().get('/api/tenant/assets/logo?v=1').set('Host', w.a.host)).headers['cache-control']).toBe('public, max-age=60')
    const versionada = await app.http().get(publico.body.branding.logoUrl).set('Host', w.a.host)
    expect(versionada.status).toBe(200)
    expect(versionada.headers['cache-control']).toBe('public, max-age=604800')
    expect((await app.http().get('/api/tenant/assets/logo').set('Host', w.b.host)).status).toBe(404)
    expect((await app.http().get('/api/tenant/assets/qualquer').set('Host', w.a.host)).status).toBe(404)
  })

  it('aluno não abre a Minha escola', async () => {
    expect((await app.http().get('/api/admin/tenant').set('Host', w.a.host).set('Authorization', bearer(w.u.studentA))).status).toBe(403)
  })
})
