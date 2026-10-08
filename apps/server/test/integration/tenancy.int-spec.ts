import { bootTestApp, type TestApp } from './helpers/app'
import { createTestDatabase, type TestDatabase } from './helpers/db'
import { HOST_MATRIZ, seedTwoPolos } from './helpers/seed'

const INDEX = '<!doctype html><html><head><title>Cursos de Extensão | Studio Pilari</title></head><body><div id="root"></div></body></html>'

describe('resolução do polo pelo endereço', () => {
  let t: TestDatabase
  let app: TestApp

  beforeAll(async () => {
    t = await createTestDatabase()
    app = await bootTestApp(t.url, { indexHtml: INDEX })
    await seedTwoPolos(t)
  })
  afterAll(async () => {
    try {
      await app?.close()
    } finally {
      await t?.drop()
    }
  })

  it('API de host desconhecido responde 404 TENANT_NOT_FOUND', async () => {
    const res = await app.http().get('/api/hello').set('Host', 'evil.example.com')
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('TENANT_NOT_FOUND')
  })

  it('site de host desconhecido responde a página 404', async () => {
    const res = await app.http().get('/curso/excel-basico').set('Host', 'evil.example.com')
    expect(res.status).toBe(404)
    expect(res.text).toContain('Polo não encontrado')
  })

  it('subdomínio de polo inexistente responde 404', async () => {
    expect((await app.http().get('/api/hello').set('Host', 'nao-existe.cursos.studiopilari.com.br')).status).toBe(404)
  })

  it.each([
    HOST_MATRIZ,
    'pilari-academy-abc123-uc.a.run.app',
    'polo-a.cursos.studiopilari.com.br',
    'Polo-A.Cursos.StudioPilari.com.br.:443',
  ])('%s resolve um polo', async (host) => {
    expect((await app.http().get('/api/hello').set('Host', host)).status).toBe(200)
  })

  it('o site do polo responde o index.html', async () => {
    const res = await app.http().get('/curso/excel-basico').set('Host', 'polo-a.cursos.studiopilari.com.br')
    expect(res.status).toBe(200)
    expect(res.text).toContain('<div id="root">')
  })

  // /webhooks/asaas fica FORA do prefixo /api (URL registrada no Asaas), mas o middleware do
  // polo roda para toda requisição, webhook incluído. Host conhecido tem que atravessar o
  // middleware e chegar no controller — sem token válido ele responde 401 (WebhookController),
  // nunca o 404 do middleware. Host desconhecido para antes, no 404 do middleware.
  it('webhook do Asaas com host conhecido chega no controller (401 sem token, não 404)', async () => {
    const res = await app.http().post('/webhooks/asaas').set('Host', HOST_MATRIZ).send({})
    expect(res.status).toBe(401)
  })

  it('webhook do Asaas com host desconhecido para no 404 do middleware', async () => {
    const res = await app.http().post('/webhooks/asaas').set('Host', 'evil.example.com').send({})
    expect(res.status).toBe(404)
    expect(res.text).toContain('Polo não encontrado')
  })
})
