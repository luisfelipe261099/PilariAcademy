import { bootTestApp, type TestApp } from './helpers/app'
import { createTestDatabase, type TestDatabase } from './helpers/db'

describe('fumaça da integração', () => {
  let t: TestDatabase
  let app: TestApp

  beforeAll(async () => {
    t = await createTestDatabase()
    app = await bootTestApp(t.url)
  })
  afterAll(async () => {
    // Guardado: se bootTestApp lançar em beforeAll, `app` fica undefined — sem o `?.` aqui
    // o close() lançaria um TypeError secundário que esconderia o erro real, e o drop() do
    // banco nunca rodaria (vazamento de banco de teste).
    try {
      await app?.close()
    } finally {
      await t?.drop()
    }
  })

  it('aplica todas as migrations e responde o catálogo vazio', async () => {
    const res = await app.http().get('/api/courses').set('Host', 'cursos.studiopilari.com.br')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ courses: [] })
  })

  it('recusa token que não é de teste', async () => {
    const res = await app
      .http()
      .get('/api/auth/me')
      .set('Host', 'cursos.studiopilari.com.br')
      .set('Authorization', 'Bearer xyz')
    expect(res.status).toBe(401)
  })

  it('a trava de banco local recusa host remoto', async () => {
    const { assertLocal } = await import('./helpers/db')
    expect(() => assertLocal('mysql://u:p@203.0.113.10:3306/x')).toThrow('banco não local')
  })
})
