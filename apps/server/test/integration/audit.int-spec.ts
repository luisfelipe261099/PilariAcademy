import { randomUUID } from 'node:crypto'
import { bootTestApp, type TestApp } from './helpers/app'
import { createTestDatabase, type TestDatabase } from './helpers/db'
import { bearer, seedTwoPolos, type TwoPolos } from './helpers/seed'
import { eventually } from './helpers/wait'

describe('auditoria por polo', () => {
  let t: TestDatabase
  let app: TestApp
  let w: TwoPolos

  beforeAll(async () => {
    t = await createTestDatabase()
    app = await bootTestApp(t.url)
    w = await seedTwoPolos(t)
    for (const [tenantId, action] of [[w.a.id, 'acao.do.a'], [w.b.id, 'acao.do.b'], [null, 'acao.da.plataforma']] as const) {
      await t.pool.query('INSERT INTO audit_logs (id, tenant_id, action, summary) VALUES (?, ?, ?, ?)', [randomUUID(), tenantId, action, action])
    }
  })
  afterAll(async () => {
    try {
      await app?.close()
    } finally {
      await t?.drop()
    }
  })

  it('o admin do polo vê só os logs do próprio polo', async () => {
    const r = await app.http().get('/api/admin/logs').set('Host', w.a.host).set('Authorization', bearer(w.u.adminA))
    expect(r.status).toBe(200)
    const acoes = (r.body.logs as Array<{ action: string }>).map((l) => l.action)
    expect(acoes).toContain('acao.do.a')
    expect(acoes).not.toContain('acao.do.b')
    expect(acoes).not.toContain('acao.da.plataforma')
  })

  it('a ação do admin fica registrada com o polo do endereço', async () => {
    const r = await app.http().post(`/api/admin/users/${w.u.studentA}/password-reset`).set('Host', w.a.host).set('Authorization', bearer(w.u.adminA))
    expect(r.status).toBe(201)
    const rows = await eventually(
      async () => (await t.pool.query("SELECT tenant_id FROM audit_logs WHERE action = 'user.password-reset'"))[0] as Array<{ tenant_id: string }>,
      (v) => v.length > 0
    )
    expect(rows).toEqual([{ tenant_id: w.a.id }])
  })
})
