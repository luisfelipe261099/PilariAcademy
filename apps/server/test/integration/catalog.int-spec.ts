import { bootTestApp, type TestApp } from './helpers/app'
import { createTestDatabase, type TestDatabase } from './helpers/db'
import { bearer, seedCategory, seedCourse, seedTenant, seedTwoPolos, type SeededTenant, type TwoPolos } from './helpers/seed'

describe('catálogo e categorias por polo', () => {
  let t: TestDatabase
  let app: TestApp
  let w: TwoPolos
  let suspenso: SeededTenant
  let catB: string

  beforeAll(async () => {
    t = await createTestDatabase()
    app = await bootTestApp(t.url)
    w = await seedTwoPolos(t)
    await seedCategory(t, { tenantId: w.a.id, name: 'Gestão', slug: 'gestao' })
    catB = await seedCategory(t, { tenantId: w.b.id, name: 'Gestão', slug: 'gestao' })
    suspenso = await seedTenant(t, { slug: 'polo-c', name: 'Polo C', status: 'suspended' })
    await seedCourse(t, { tenantId: suspenso.id, slug: 'curso-c', title: 'Curso C', instructorId: w.u.adminMatriz })
    await t.pool.query('UPDATE courses SET cover_image_url = ? WHERE id = ?', ['https://img.fake/b.png', w.courses.b.id])
  })
  afterAll(async () => {
    try {
      await app?.close()
    } finally {
      await t?.drop()
    }
  })

  const titulos = async (host: string) =>
    ((await app.http().get('/api/courses').set('Host', host)).body.courses as Array<{ title: string }>).map((c) => c.title)

  it('cada endereço lista só os cursos publicados do próprio polo', async () => {
    expect(await titulos(w.a.host)).toEqual(['Excel do Polo A'])
    expect(await titulos(w.b.host)).toEqual(['Excel do Polo B'])
    expect(await titulos(w.matriz.host)).toEqual(['Excel da Matriz'])
  })

  it('o mesmo slug abre o curso do polo do endereço', async () => {
    expect((await app.http().get('/api/courses/excel-basico').set('Host', w.a.host)).body.course.title).toBe('Excel do Polo A')
    expect((await app.http().get('/api/courses/excel-basico').set('Host', w.b.host)).body.course.title).toBe('Excel do Polo B')
  })

  it('rascunho não aparece nem pelo slug', async () => {
    expect((await app.http().get('/api/courses/rascunho-a').set('Host', w.a.host)).status).toBe(404)
  })

  it('categorias são do polo do endereço', async () => {
    const b = await app.http().get('/api/categories').set('Host', w.b.host)
    expect(b.body.categories).toEqual([{ id: catB, name: 'Gestão', slug: 'gestao' }])
  })

  it('o admin cria categoria no próprio polo, com slug independente dos outros', async () => {
    const a = await app.http().post('/api/admin/categories').set('Host', w.a.host).set('Authorization', bearer(w.u.adminA)).send({ name: 'Marketing' })
    const b = await app.http().post('/api/admin/categories').set('Host', w.b.host).set('Authorization', bearer(w.u.adminB)).send({ name: 'Marketing' })
    expect(a.body.category.slug).toBe('marketing')
    expect(b.body.category.slug).toBe('marketing')
    const [rows] = await t.pool.query('SELECT tenant_id FROM categories WHERE id = ?', [a.body.category.id])
    expect(rows).toEqual([{ tenant_id: w.a.id }])
  })

  it('categoria de outro polo responde 404', async () => {
    const auth = { Host: w.a.host, Authorization: bearer(w.u.adminA) }
    expect((await app.http().patch(`/api/admin/categories/${catB}`).set(auth).send({ name: 'X' })).status).toBe(404)
    expect((await app.http().delete(`/api/admin/categories/${catB}`).set(auth)).status).toBe(404)
  })

  it('polo suspenso fecha o catálogo', async () => {
    const r = await app.http().get('/api/courses').set('Host', suspenso.host)
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('TENANT_SUSPENDED')
  })

  it('polo suspenso continua respondendo as próprias categorias (o painel do polo usa), e só as dele', async () => {
    const catC = await seedCategory(t, { tenantId: suspenso.id, name: 'Saúde', slug: 'saude' })
    const r = await app.http().get('/api/categories').set('Host', suspenso.host)
    expect(r.status).toBe(200)
    expect(r.body.categories).toEqual([{ id: catC, name: 'Saúde', slug: 'saude' }])
  })

  it('capa do bucket acima de 5 MB não é servida (o teto do proxy vale), e no limite é', async () => {
    const capa = (bytes: number) => ({ buffer: Buffer.alloc(bytes, 0x89), contentType: 'image/png' })
    const caminho = `cursos/${w.courses.a.id}/cover/capa.png`
    await t.pool.query('UPDATE courses SET cover_image_url = ? WHERE id = ?', [caminho, w.courses.a.id])
    app.fakes.gcs.objects.set(caminho, capa(5 * 1024 * 1024 + 1))
    const grande = await app.http().get(`/api/courses/${w.courses.a.id}/cover`).set('Host', w.a.host)
    expect([grande.status, grande.text]).toEqual([404, 'Sem capa'])
    app.fakes.gcs.objects.set(caminho, capa(5 * 1024 * 1024))
    expect((await app.http().get(`/api/courses/${w.courses.a.id}/cover`).set('Host', w.a.host)).status).toBe(200)
    await t.pool.query('UPDATE courses SET cover_image_url = NULL WHERE id = ?', [w.courses.a.id])
  })

  it('capa de curso de outro polo responde 404', async () => {
    expect((await app.http().get(`/api/courses/${w.courses.b.id}/cover`).set('Host', w.a.host)).status).toBe(404)
    expect((await app.http().get(`/api/courses/${w.courses.b.id}/cover`).set('Host', w.b.host)).status).toBe(302)
  })
})
