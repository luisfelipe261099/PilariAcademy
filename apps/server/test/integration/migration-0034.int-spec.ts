import { copyMigrationsUpTo, createTestDatabase, migrateAll, type TestDatabase } from './helpers/db'

const MATRIZ = 'accbdc75-009f-4aa2-9fd3-e92d11f3b06d'

async function q<T = Record<string, unknown>>(t: TestDatabase, sql: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await t.pool.query(sql, params)
  return rows as T[]
}

describe('migration 0034 (fundação multi-polo)', () => {
  let t: TestDatabase

  beforeAll(async () => {
    t = await createTestDatabase()
    await migrateAll(t, await copyMigrationsUpTo(33))
    // Dados no formato ANTERIOR à 0034 (sem tenant_id), via SQL cru.
    await t.pool.query(`INSERT INTO users (uid, email, display_name, roles, disabled) VALUES
      ('u-admin','admin@x.com','Admin', JSON_ARRAY('admin'), false),
      ('u-prof','prof@x.com','Prof', JSON_ARRAY('teacher'), false),
      ('u-aluno','aluno@x.com','Aluno', JSON_ARRAY('student'), false),
      ('u-sem-papel','sem@x.com', NULL, NULL, false)`)
    await t.pool.query(`INSERT INTO categories (id, name, slug) VALUES ('cat-1','Informática','informatica')`)
    await t.pool.query(`INSERT INTO courses (id, slug, instructor_id, category_id, kind, title, price_in_cents, status, published_at) VALUES
      ('c-pub','excel-basico','u-prof','cat-1','online','Excel Básico',3499,'published','2026-08-01 10:00:00.000'),
      ('c-draft','rascunho','u-prof',NULL,'online','Rascunho',0,'draft',NULL)`)
    await t.pool.query(`INSERT INTO coupons (id, code, type, value) VALUES ('cp-1','BEMVINDO','percent',10)`)
    await t.pool.query(`INSERT INTO orders (id, user_id, status, subtotal_in_cents, total_in_cents) VALUES ('o-1','u-aluno','paid',3499,3499)`)
    await t.pool.query(`INSERT INTO coupon_redemptions (id, coupon_code, user_id, order_id) VALUES ('cr-1','BEMVINDO','u-aluno','o-1')`)
    await t.pool.query(`INSERT INTO earnings (id, order_id, course_id, instructor_id, gross_in_cents, commission_percent, net_in_cents) VALUES ('e-1','o-1','c-pub','u-prof',3499,50,1700)`)
    await t.pool.query(`INSERT INTO payouts (id, instructor_id, amount_in_cents) VALUES ('p-1','u-prof',1000)`)
    await t.pool.query(`INSERT INTO audit_logs (id, action, summary) VALUES ('a-1','course.create','Criou o curso')`)
    await migrateAll(t) // aplica só a 0034
  })
  // Guardado: se beforeAll lançar antes de atribuir `t` (ex.: migrateAll falhar), `t` fica
  // undefined e o drop() sem `?.` lançaria um TypeError secundário sobre o erro real.
  afterAll(() => t?.drop())

  it('cria a matriz com o domínio primário', async () => {
    const [m] = await q<{ slug: string; is_matriz: number; status: string }>(t, 'SELECT slug, is_matriz, status FROM tenants WHERE id = ?', [MATRIZ])
    expect(m).toEqual({ slug: 'pilari', is_matriz: 1, status: 'active' })
    const d = await q(t, 'SELECT host, is_primary FROM tenant_domains WHERE tenant_id = ?', [MATRIZ])
    expect(d).toEqual([{ host: 'cursos.studiopilari.com.br', is_primary: 1 }])
  })

  it.each(['categories', 'courses', 'coupons', 'coupon_redemptions', 'orders', 'earnings', 'payouts', 'audit_logs'])(
    'marca todas as linhas de %s com a matriz',
    async (tabela) => {
      const rows = await q<{ tenant_id: string | null }>(t, `SELECT tenant_id FROM \`${tabela}\``)
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.every((r) => r.tenant_id === MATRIZ)).toBe(true)
    }
  )

  it('ninguém ganha o sinal de plataforma: os admins atuais viram admins da matriz, e é isso que os faz da plataforma', async () => {
    const rows = await q<{ uid: string; is_platform_admin: number }>(t, 'SELECT uid, is_platform_admin FROM users ORDER BY uid')
    expect(rows).toEqual([
      { uid: 'u-admin', is_platform_admin: 0 },
      { uid: 'u-aluno', is_platform_admin: 0 },
      { uid: 'u-prof', is_platform_admin: 0 },
      { uid: 'u-sem-papel', is_platform_admin: 0 },
    ])
    // O admin de hoje é admin da matriz: pela regra do código (sinal OU admin da matriz), segue com o poder de plataforma,
    // e a tela de usuários da matriz passa a ser onde ele é dado e tirado.
    const admins = await q<{ user_uid: string }>(
      t,
      `SELECT user_uid FROM tenant_members WHERE tenant_id = ? AND JSON_CONTAINS(roles, '"admin"') ORDER BY user_uid`,
      [MATRIZ]
    )
    expect(admins).toEqual([{ user_uid: 'u-admin' }])
  })

  it('copia todo usuário para a matriz com os papéis atuais', async () => {
    const rows = await q<{ user_uid: string; roles: string[] }>(t, 'SELECT user_uid, roles FROM tenant_members WHERE tenant_id = ? ORDER BY user_uid', [MATRIZ])
    expect(rows.map((r) => [r.user_uid, r.roles])).toEqual([
      ['u-admin', ['admin']],
      ['u-aluno', ['student']],
      ['u-prof', ['teacher']],
      ['u-sem-papel', ['student']],
    ])
  })

  it('aprova só os cursos que já estavam publicados', async () => {
    const rows = await q<{ id: string; approved_at: Date | null }>(t, 'SELECT id, approved_at FROM courses ORDER BY id')
    expect(rows.find((r) => r.id === 'c-pub')?.approved_at).not.toBeNull()
    expect(rows.find((r) => r.id === 'c-draft')?.approved_at).toBeNull()
  })

  it('slug de curso é único por polo, não na rede', async () => {
    await t.pool.query(`INSERT INTO tenants (id, slug, name, branding) VALUES ('t-b','polo-b','Polo B', JSON_OBJECT('primaryColor','#123456','accentColor','#654321'))`)
    await t.pool.query(`INSERT INTO courses (id, tenant_id, slug, instructor_id, kind, title) VALUES ('c-b','t-b','excel-basico','u-prof','online','Excel B')`)
    await expect(
      t.pool.query(`INSERT INTO courses (id, tenant_id, slug, instructor_id, kind, title) VALUES ('c-b2','t-b','excel-basico','u-prof','online','Excel B2')`)
    ).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' })
  })

  it('código de cupom é único por polo', async () => {
    await t.pool.query(`INSERT INTO coupons (id, tenant_id, code, type, value) VALUES ('cp-b','t-b','BEMVINDO','fixed',500)`)
    await expect(
      t.pool.query(`INSERT INTO coupons (id, tenant_id, code, type, value) VALUES ('cp-b2','t-b','BEMVINDO','fixed',100)`)
    ).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' })
  })

  it('insert no formato antigo, sem tenant_id, cai na matriz', async () => {
    await t.pool.query(`INSERT INTO categories (id, name, slug) VALUES ('cat-2','Gestão','gestao')`)
    const [row] = await q<{ tenant_id: string }>(t, `SELECT tenant_id FROM categories WHERE id = 'cat-2'`)
    expect(row.tenant_id).toBe(MATRIZ)
  })
})
