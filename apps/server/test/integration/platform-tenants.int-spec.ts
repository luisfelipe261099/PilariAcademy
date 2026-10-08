import { ServiceUnavailableException } from '@nestjs/common'
import { TenantMembersService } from '../../src/modules/tenancy/tenant-members.service'
import { bootTestApp, type TestApp } from './helpers/app'
import { createTestDatabase, type TestDatabase } from './helpers/db'
import { bearer, hostOf, seedTwoPolos, type TwoPolos } from './helpers/seed'
import { eventually } from './helpers/wait'

/** A mensagem de erro do Nest vem como texto (serviço) ou como lista (validação do corpo). */
const mensagem = (body: { message?: string | string[] }): string => [body.message ?? ''].flat().join(' ')
/** Todas as mensagens do corpo de erro, em ordem alfabética (a validação devolve uma lista, na ordem dos campos). */
const mensagens = (body: { message?: string | string[] }): string[] => [body.message ?? ''].flat().sort()
/** A senha aleatória das contas criadas pelo console: uma de cada classe, para nenhuma política do Firebase a recusar. */
const senhaForte = (senha: string | undefined): boolean =>
  !!senha && senha.length >= 32 && /[a-z]/.test(senha) && /[A-Z]/.test(senha) && /[0-9]/.test(senha) && /[^A-Za-z0-9]/.test(senha)

describe('console da plataforma: polos', () => {
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
  afterEach(() => {
    jest.restoreAllMocks()
  })

  const comoPlataforma = () => ({ Host: w.matriz.host, Authorization: bearer(w.u.platform) })
  const consulta = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => (await t.pool.query(sql, params))[0] as T[]
  const criarPolo = (body: object) => app.http().post('/api/platform/tenants').set(comoPlataforma()).send(body)
  const editarPolo = (id: string, body: object) => app.http().patch(`/api/platform/tenants/${id}`).set(comoPlataforma()).send(body)
  const vincularAdmin = (id: string, body: object) => app.http().post(`/api/platform/tenants/${id}/admins`).set(comoPlataforma()).send(body)
  const cadastrarDominio = (id: string, host: string) => app.http().post(`/api/platform/tenants/${id}/domains`).set(comoPlataforma()).send({ host })
  const removerDominio = (id: string, host: string) => app.http().delete(`/api/platform/tenants/${id}/domains/${host}`).set(comoPlataforma())
  /** Quanto há de cada coisa que a criação de polo mexe: se uma tentativa falhar, tudo volta a estes números. */
  const contagens = async () => {
    const n = async (tabela: 'tenants' | 'tenant_domains' | 'tenant_members' | 'users') =>
      Number((await consulta<{ n: number }>(`SELECT COUNT(*) AS n FROM ${tabela}`))[0].n)
    return { tenants: await n('tenants'), tenant_domains: await n('tenant_domains'), tenant_members: await n('tenant_members'), users: await n('users') }
  }
  /** O vínculo é a última etapa antes do link de senha: fazê-lo falhar simula "a conta já foi criada e o banco caiu". */
  const falharProximoVinculo = () =>
    jest.spyOn(app.app.get(TenantMembersService), 'setRoles').mockRejectedValueOnce(new ServiceUnavailableException('Banco indisponível.'))

  // Os testes dependem da ordem: o mundo semeado vai mudando (polos criados, admins vinculados, domínios). Os que só
  // leem vêm antes dos que gravam, e a auditoria, que soma o que todos fizeram, fica por último.

  it('só a plataforma abre o console', async () => {
    expect((await app.http().get('/api/platform/tenants').set('Host', w.matriz.host)).status).toBe(401)
    // Admin de polo, em qualquer endereço, não abre. O admin da matriz abre: é admin da plataforma pela tela da matriz (B10).
    expect((await app.http().get('/api/platform/tenants').set('Host', w.matriz.host).set('Authorization', bearer(w.u.adminA))).status).toBe(403)
    expect((await app.http().get('/api/platform/tenants').set('Host', w.a.host).set('Authorization', bearer(w.u.adminA))).status).toBe(403)
    expect((await app.http().get('/api/platform/tenants').set('Host', w.matriz.host).set('Authorization', bearer(w.u.adminMatriz))).status).toBe(200)
    const r = await app.http().get('/api/platform/tenants').set(comoPlataforma())
    expect(r.status).toBe(200)
    const a = (r.body.tenants as Array<Record<string, unknown>>).find((x) => x.slug === 'polo-a')
    expect(a).toMatchObject({ adminCount: 1, studentCount: 2, publishedCourseCount: 1, inReviewCount: 0, siteUrl: 'https://polo-a.cursos.studiopilari.com.br' })
    // A matriz vem primeiro; os polos, por nome.
    expect((r.body.tenants as Array<{ slug: string; isMatriz: boolean }>).map((x) => [x.slug, x.isMatriz])).toEqual([
      ['pilari', true], ['polo-a', false], ['polo-b', false],
    ])
  })

  it('admin de polo não cria polo por esta porta: 403 e nada é gravado', async () => {
    const r = await app.http().post('/api/platform/tenants').set('Host', w.a.host).set('Authorization', bearer(w.u.adminA))
      .send({ slug: 'invasor', name: 'Invasor', firstAdminEmail: 'invasor@x.com', firstAdminName: 'Invasor' })
    expect(r.status).toBe(403)
    expect(await consulta("SELECT id FROM tenants WHERE slug = 'invasor'")).toEqual([])
    expect(app.fakes.identity.emails.has('invasor@x.com')).toBe(false)
  })

  it('o detalhe do polo traz a marca e os domínios; polo inexistente responde 404', async () => {
    const r = await app.http().get(`/api/platform/tenants/${w.a.id}`).set(comoPlataforma())
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({
      id: w.a.id, slug: 'polo-a', name: 'Polo A', status: 'active', isMatriz: false, adminCount: 1, domains: ['polo-a.cursos.studiopilari.com.br'],
    })
    expect(r.body.branding).toMatchObject({ primaryColor: '#0055aa', accentColor: '#ff6600', whatsapp: '5541900000000' })
    const m = await app.http().get(`/api/platform/tenants/${w.matriz.id}`).set(comoPlataforma())
    expect(m.body).toMatchObject({ isMatriz: true, siteUrl: 'https://cursos.studiopilari.com.br' })
    expect((await app.http().get('/api/platform/tenants/nao-existe').set(comoPlataforma())).status).toBe(404)
  })

  it('B9: polo inexistente responde 404 TENANT_NOT_FOUND em toda rota do console', async () => {
    const esperado = { statusCode: 404, code: 'TENANT_NOT_FOUND', message: 'Polo não encontrado.' }
    const respostas = [
      await app.http().get('/api/platform/tenants/nao-existe').set(comoPlataforma()),
      await editarPolo('nao-existe', { name: 'Fantasma' }),
      await vincularAdmin('nao-existe', { email: 'fantasma@x.com', name: 'Fantasma' }),
      await cadastrarDominio('nao-existe', 'fantasma.com.br'),
      await removerDominio('nao-existe', 'fantasma.com.br'),
      await app.http().post('/api/platform/tenants/nao-existe/upload-url').set(comoPlataforma()).send({ kind: 'logo', fileName: 'l.png', contentType: 'image/png' }),
    ]
    expect(respostas.map((r) => [r.status, r.body])).toEqual(respostas.map(() => [404, esperado]))
    expect(app.fakes.identity.emails.has('fantasma@x.com')).toBe(false)
  })

  it('cria o polo com o primeiro admin e o site do polo passa a abrir', async () => {
    const r = await criarPolo({
      slug: 'polo-novo', name: 'Polo Novo', branding: { primaryColor: '#0a7d3b', whatsapp: '5541911112222' },
      firstAdminEmail: 'Diretora@Polo-Novo.com.br', firstAdminName: '  Diretora do Polo  ',
    })
    expect(r.status).toBe(201)
    expect(r.body.firstAdmin).toMatchObject({ email: 'diretora@polo-novo.com.br', existingAccount: false, resetEmailSent: true })
    expect(r.body.tenant).toMatchObject({
      slug: 'polo-novo', name: 'Polo Novo', status: 'active', adminCount: 1, studentCount: 0,
      siteUrl: 'https://polo-novo.cursos.studiopilari.com.br', domains: ['polo-novo.cursos.studiopilari.com.br'],
    })
    expect(r.body.tenant.branding).toMatchObject({ primaryColor: '#0a7d3b', whatsapp: '5541911112222' })
    expect(app.fakes.identity.resetEmails).toContain('diretora@polo-novo.com.br')
    // O que o Firebase recebeu: e-mail em minúsculo, nome aparado e uma senha que nenhuma política de senha recusa.
    const criada = app.fakes.identity.created.find((c) => c.email === 'diretora@polo-novo.com.br')
    expect(criada).toMatchObject({ email: 'diretora@polo-novo.com.br', displayName: 'Diretora do Polo' })
    expect(senhaForte(criada?.password)).toBe(true)
    expect(await consulta('SELECT email, display_name FROM users WHERE uid = ?', [r.body.firstAdmin.uid])).toEqual([
      { email: 'diretora@polo-novo.com.br', display_name: 'Diretora do Polo' },
    ])
    const site = await app.http().get('/api/tenant').set('Host', hostOf('polo-novo'))
    expect(site.body).toMatchObject({ slug: 'polo-novo', name: 'Polo Novo' })
    const me = await app.http().get('/api/auth/me').set('Host', hostOf('polo-novo')).set('Authorization', bearer(r.body.firstAdmin.uid))
    expect(me.body.roles).toEqual(['admin'])
    // A plataforma não vira membro do polo que criou.
    expect(await consulta('SELECT user_uid FROM tenant_members WHERE tenant_id = ?', [r.body.tenant.id])).toEqual([{ user_uid: r.body.firstAdmin.uid }])
  })

  it('e-mail que já tem conta só vira admin do polo', async () => {
    app.fakes.identity.emails.set('u-adm-a@teste.local', w.u.adminA)
    const novo = await criarPolo({
      slug: 'polo-irmao', name: 'Polo Irmão', firstAdminEmail: 'u-adm-a@teste.local', firstAdminName: 'Outro Nome',
    })
    expect(novo.status).toBe(201)
    expect(novo.body.firstAdmin).toMatchObject({ uid: w.u.adminA, existingAccount: true, resetEmailSent: false })
    expect(app.fakes.identity.resetEmails).not.toContain('u-adm-a@teste.local')
    const [nome] = await t.pool.query('SELECT display_name FROM users WHERE uid = ?', [w.u.adminA])
    expect(nome).toEqual([{ display_name: `Usuário ${w.u.adminA}` }])
    // A mesma conta passa a valer nos dois polos, com papéis separados.
    expect(await consulta('SELECT tenant_id FROM tenant_members WHERE user_uid = ? ORDER BY tenant_id', [w.u.adminA])).toHaveLength(2)
    const me = await app.http().get('/api/auth/me').set('Host', hostOf('polo-irmao')).set('Authorization', bearer(w.u.adminA))
    expect(me.body.roles).toEqual(['admin'])
  })

  it('endereço reservado, inválido ou repetido é recusado', async () => {
    const base = { name: 'Polo X', firstAdminEmail: 'x@x.com', firstAdminName: 'X X' }
    const reservado = await criarPolo({ ...base, slug: 'admin' })
    expect(reservado.status).toBe(400)
    expect(mensagem(reservado.body)).toContain('nomes reservados')
    const invalido = await criarPolo({ ...base, slug: 'Polo A' })
    expect(invalido.status).toBe(400)
    expect(mensagem(invalido.body)).toContain('Endereço do polo')
    const repetido = await criarPolo({ ...base, slug: 'polo-a' })
    expect(repetido.status).toBe(409)
    expect(repetido.body.message).toBe('Já existe um polo com este endereço.')
    // Nenhuma das três recusas deixou conta criada nem polo novo para trás.
    expect(app.fakes.identity.emails.has('x@x.com')).toBe(false)
    expect(await consulta("SELECT id FROM tenants WHERE slug IN ('admin', 'polo a', 'Polo A')")).toEqual([])
  })

  it('o nome do admin é validado depois de aparado: só espaços ou uma letra entre espaços é recusado, e nada é criado', async () => {
    const antes = await contagens()
    const criadasAntes = app.fakes.identity.created.length
    for (const nome of ['', '   ', ' A ', '\t']) {
      const polo = await criarPolo({ slug: 'polo-sem-nome', name: 'Polo Sem Nome', firstAdminEmail: 'sem-nome@x.com', firstAdminName: nome })
      expect([nome, polo.status, mensagens(polo.body)]).toEqual([nome, 400, ['Informe o nome do admin (2 a 120 caracteres).']])
      const vinculo = await vincularAdmin(w.a.id, { email: 'sem-nome@x.com', name: nome })
      expect([nome, vinculo.status, mensagens(vinculo.body)]).toEqual([nome, 400, ['Informe o nome do admin (2 a 120 caracteres).']])
    }
    expect(await contagens()).toEqual(antes)
    expect(app.fakes.identity.created).toHaveLength(criadasAntes)
  })

  it('toda mensagem de validação do console sai em português', async () => {
    const polo = await criarPolo({})
    expect(polo.status).toBe(400)
    expect(mensagens(polo.body)).toEqual([
      'E-mail do admin inválido.',
      'Endereço do polo: use de 3 a 40 letras minúsculas, números e hífen.',
      'Informe o endereço do polo.',
      'Informe o nome do admin (2 a 120 caracteres).',
      'Informe o nome do admin.',
      'Informe o nome do polo (2 a 160 caracteres).',
      'Informe o nome do polo.',
    ])
    const admin = await vincularAdmin(w.a.id, {})
    expect(admin.status).toBe(400)
    expect(mensagens(admin.body)).toEqual(['E-mail inválido.', 'Informe o nome do admin (2 a 120 caracteres).', 'Informe o nome do admin.'])
    const dominio = await cadastrarDominio(w.a.id, '')
    expect(dominio.status).toBe(400)
    expect(mensagens(dominio.body)).toEqual(['Informe o domínio (4 a 253 caracteres).'])
    const semCorpo = await app.http().post(`/api/platform/tenants/${w.a.id}/domains`).set(comoPlataforma()).send({})
    expect(mensagens(semCorpo.body)).toEqual(['Informe o domínio (4 a 253 caracteres).', 'Informe o domínio.'])
    const edicao = await editarPolo(w.a.id, { name: 'X', status: 'apagado', branding: 'azul' })
    expect(edicao.status).toBe(400)
    expect(mensagens(edicao.body)).toEqual([
      'Informe o nome do polo (2 a 160 caracteres).',
      'Marca do polo inválida.',
      'Situação do polo inválida: use "active" ou "suspended".',
    ])
  })

  it('o endereço do site já registrado como domínio responde 409 e não deixa polo pela metade', async () => {
    // O pré-check olha só o slug: o domínio <slug>.<base> de outro polo passa por ele e só a unique do banco o barra.
    await t.pool.query('INSERT INTO tenant_domains (host, tenant_id, is_primary) VALUES (?, ?, 0)', [hostOf('polo-orfao'), w.b.id])
    const r = await criarPolo({ slug: 'polo-orfao', name: 'Polo Órfão', firstAdminEmail: 'orfao@x.com', firstAdminName: 'Órfão' })
    expect(r.status).toBe(409)
    expect(r.body.message).toBe('Já existe um polo com este endereço.')
    expect(await consulta("SELECT id FROM tenants WHERE slug = 'polo-orfao'")).toEqual([])
    expect(app.fakes.identity.emails.has('orfao@x.com')).toBe(false)
    await t.pool.query('DELETE FROM tenant_domains WHERE host = ?', [hostOf('polo-orfao')])
  })

  it('duas criações simultâneas do mesmo endereço: uma vence e a outra responde 409, nunca 500', async () => {
    const corpo = { slug: 'polo-corrida', name: 'Polo Corrida', firstAdminEmail: 'corrida@x.com', firstAdminName: 'Corrida' }
    const [r1, r2] = await Promise.all([criarPolo(corpo), criarPolo(corpo)])
    expect([r1.status, r2.status].sort()).toEqual([201, 409])
    const perdedora = r1.status === 409 ? r1 : r2
    expect(perdedora.body.message).toBe('Já existe um polo com este endereço.')
    expect(await consulta("SELECT id FROM tenants WHERE slug = 'polo-corrida'")).toHaveLength(1)
    expect(await consulta('SELECT host FROM tenant_domains WHERE host = ?', [hostOf('polo-corrida')])).toHaveLength(1)
  })

  it('o Firebase recusa o primeiro admin: nenhum polo, domínio, vínculo ou conta fica, o erro original chega e a nova tentativa passa', async () => {
    const corpo = { slug: 'polo-falha', name: 'Polo Falha', firstAdminEmail: 'Falha@X.com', firstAdminName: 'Falha' }
    const antes = await contagens()
    // Enquanto o Firebase "pensa", o polo já está no banco e aberto: a requisição de dentro do dublê põe o endereço no
    // cache de host (60 s), e a compensação precisa limpá-lo, senão o endereço seguiria abrindo um polo que não existe mais.
    let duranteACriacao: number | undefined
    jest.spyOn(app.fakes.identity, 'createIdentity').mockImplementationOnce(async () => {
      duranteACriacao = (await app.http().get('/api/tenant').set('Host', hostOf('polo-falha'))).status
      throw new ServiceUnavailableException('Firebase indisponível.')
    })

    const r = await criarPolo(corpo)

    expect(duranteACriacao).toBe(200)
    // O erro é o ORIGINAL, não o 409 "Já existe um polo com este endereço." que a nova tentativa daria sem a compensação.
    expect(r.status).toBe(503)
    expect(r.body.message).toBe('Firebase indisponível.')
    expect(await contagens()).toEqual(antes)
    expect(await consulta("SELECT id FROM tenants WHERE slug = 'polo-falha'")).toEqual([])
    expect(await consulta('SELECT host FROM tenant_domains WHERE host = ?', [hostOf('polo-falha')])).toEqual([])
    expect(app.fakes.identity.emails.has('falha@x.com')).toBe(false)
    expect((await app.http().get('/api/tenant').set('Host', hostOf('polo-falha'))).status).toBe(404)
    // Sem polo, sem log de criação.
    expect(await consulta("SELECT id FROM audit_logs WHERE action = 'tenant.create' AND summary LIKE '%polo-falha%'")).toEqual([])

    // A nova tentativa, com o mesmo endereço, passa.
    const denovo = await criarPolo(corpo)
    expect(denovo.status).toBe(201)
    expect(denovo.body.tenant).toMatchObject({ slug: 'polo-falha', adminCount: 1, domains: [hostOf('polo-falha')] })
    expect(denovo.body.firstAdmin).toMatchObject({ email: 'falha@x.com', existingAccount: false, resetEmailSent: true })
    expect((await app.http().get('/api/tenant').set('Host', hostOf('polo-falha'))).body).toMatchObject({ slug: 'polo-falha' })
  })

  it('o vínculo falha depois de a conta nova ser criada: a conta e o cadastro dela também são desfeitos, e a nova tentativa manda o link', async () => {
    const corpo = { slug: 'polo-falha-b', name: 'Polo Falha B', firstAdminEmail: 'falha-b@x.com', firstAdminName: 'Falha B' }
    const antes = await contagens()
    const apagadasAntes = app.fakes.identity.deleted.length
    const linksAntes = app.fakes.identity.resetEmails.length
    falharProximoVinculo()

    const r = await criarPolo(corpo)

    expect(r.status).toBe(503)
    expect(r.body.message).toBe('Banco indisponível.')
    // A conta chegou a ser criada no Firebase e foi apagada de lá, junto com o cadastro espelhado e o polo.
    expect(app.fakes.identity.created.some((c) => c.email === 'falha-b@x.com')).toBe(true)
    expect(app.fakes.identity.deleted).toHaveLength(apagadasAntes + 1)
    expect(app.fakes.identity.emails.has('falha-b@x.com')).toBe(false)
    expect(await consulta("SELECT uid FROM users WHERE email = 'falha-b@x.com'")).toEqual([])
    expect(await contagens()).toEqual(antes)
    // Ninguém recebeu link de senha de uma conta que deixou de existir.
    expect(app.fakes.identity.resetEmails).toHaveLength(linksAntes)

    const denovo = await criarPolo(corpo)
    expect(denovo.status).toBe(201)
    expect(denovo.body.firstAdmin).toMatchObject({ email: 'falha-b@x.com', existingAccount: false, resetEmailSent: true })
    expect(app.fakes.identity.resetEmails).toHaveLength(linksAntes + 1)
  })

  it('o primeiro admin já tinha conta na rede e o vínculo falha: o polo some, a conta e os vínculos dela em outros polos ficam intactos', async () => {
    app.fakes.identity.emails.set('u-prof-b@teste.local', w.u.teacherB)
    const corpo = { slug: 'polo-falha-c', name: 'Polo Falha C', firstAdminEmail: 'u-prof-b@teste.local', firstAdminName: 'Prof B' }
    const antes = await contagens()
    const apagadasAntes = app.fakes.identity.deleted.length
    const vinculosAntes = await consulta('SELECT tenant_id, roles FROM tenant_members WHERE user_uid = ?', [w.u.teacherB])
    falharProximoVinculo()

    expect((await criarPolo(corpo)).status).toBe(503)

    expect(await contagens()).toEqual(antes)
    expect(app.fakes.identity.deleted).toHaveLength(apagadasAntes)
    expect(app.fakes.identity.emails.get('u-prof-b@teste.local')).toBe(w.u.teacherB)
    expect(await consulta('SELECT tenant_id, roles FROM tenant_members WHERE user_uid = ?', [w.u.teacherB])).toEqual(vinculosAntes)
    expect(await consulta('SELECT display_name FROM users WHERE uid = ?', [w.u.teacherB])).toEqual([{ display_name: `Usuário ${w.u.teacherB}` }])

    const denovo = await criarPolo(corpo)
    expect(denovo.status).toBe(201)
    expect(denovo.body.firstAdmin).toMatchObject({ uid: w.u.teacherB, existingAccount: true, resetEmailSent: false })
  })

  it('vincula mais um admin a um polo que já existe', async () => {
    // Conta que já existe: o professor do polo A ganha o papel de admin, mantém o de professor e o cadastro dele.
    app.fakes.identity.emails.set('u-prof-a@teste.local', w.u.teacherA)
    const velho = await vincularAdmin(w.a.id, { email: 'U-Prof-A@teste.local', name: 'Outro Nome' })
    expect(velho.status).toBe(201)
    expect(velho.body).toEqual({ uid: w.u.teacherA, email: 'u-prof-a@teste.local', existingAccount: true, resetEmailSent: false })
    expect(await consulta('SELECT roles FROM tenant_members WHERE tenant_id = ? AND user_uid = ?', [w.a.id, w.u.teacherA])).toEqual([{ roles: ['teacher', 'admin'] }])
    expect(await consulta('SELECT display_name FROM users WHERE uid = ?', [w.u.teacherA])).toEqual([{ display_name: `Usuário ${w.u.teacherA}` }])

    // E-mail novo: conta nova, admin do polo e link de definir senha.
    const novo = await vincularAdmin(w.a.id, { email: 'Nova.Pessoa@Polo-A.com.br', name: '  Nova Pessoa ' })
    expect(novo.status).toBe(201)
    expect(novo.body).toMatchObject({ email: 'nova.pessoa@polo-a.com.br', existingAccount: false, resetEmailSent: true })
    expect(app.fakes.identity.resetEmails).toContain('nova.pessoa@polo-a.com.br')
    expect(await consulta('SELECT email, display_name FROM users WHERE uid = ?', [novo.body.uid])).toEqual([
      { email: 'nova.pessoa@polo-a.com.br', display_name: 'Nova Pessoa' },
    ])
    expect(await consulta('SELECT tenant_id, roles FROM tenant_members WHERE user_uid = ?', [novo.body.uid])).toEqual([{ tenant_id: w.a.id, roles: ['admin'] }])
    const nova = await app.http().get('/api/auth/me').set('Host', w.a.host).set('Authorization', bearer(novo.body.uid))
    expect(nova.body.roles).toEqual(['admin'])

    // Repetir o vínculo não duplica o papel.
    const repetido = await vincularAdmin(w.a.id, { email: 'nova.pessoa@polo-a.com.br', name: 'Nova Pessoa' })
    expect(repetido.body).toMatchObject({ uid: novo.body.uid, existingAccount: true, resetEmailSent: false })
    expect(await consulta('SELECT roles FROM tenant_members WHERE user_uid = ?', [novo.body.uid])).toEqual([{ roles: ['admin'] }])

    // A lista conta os três admins do polo A (o original, o professor promovido e a pessoa nova).
    const detalhe = await app.http().get(`/api/platform/tenants/${w.a.id}`).set(comoPlataforma())
    expect(detalhe.body.adminCount).toBe(3)

    // Recusas: polo inexistente (sem criar conta), e-mail inválido e nome ausente.
    expect((await vincularAdmin('nao-existe', { email: 'fantasma@x.com', name: 'Fantasma' })).status).toBe(404)
    expect(app.fakes.identity.emails.has('fantasma@x.com')).toBe(false)
    expect((await vincularAdmin(w.a.id, { email: 'sem-arroba', name: 'Ab' })).status).toBe(400)
    expect((await vincularAdmin(w.a.id, { email: 'a@b.com' })).status).toBe(400)
  })

  it('B11: vincular de novo quem tem conta mas nunca entrou reenvia o link de definir senha; quem já entrou não recebe', async () => {
    const email = 'nunca-entrou@polo-b.com.br'
    const primeiro = await vincularAdmin(w.b.id, { email, name: 'Nunca Entrou' })
    expect(primeiro.body).toMatchObject({ existingAccount: false, resetEmailSent: true })
    // O link da primeira vez se perdeu: a conta existe e nunca entrou.
    app.fakes.identity.neverSignedIn.add(primeiro.body.uid)
    const envios = app.fakes.identity.resetEmails.filter((e) => e === email).length
    const denovo = await vincularAdmin(w.a.id, { email, name: 'Nunca Entrou' })
    expect([denovo.status, denovo.body]).toEqual([201, { uid: primeiro.body.uid, email, existingAccount: true, resetEmailSent: true }])
    expect(app.fakes.identity.resetEmails.filter((e) => e === email)).toHaveLength(envios + 1)
    // Depois que ela entra, vincular de novo não manda link.
    app.fakes.identity.neverSignedIn.delete(primeiro.body.uid)
    const depois = await vincularAdmin(w.a.id, { email, name: 'Nunca Entrou' })
    expect(depois.body).toMatchObject({ existingAccount: true, resetEmailSent: false })
    expect(app.fakes.identity.resetEmails.filter((e) => e === email)).toHaveLength(envios + 1)
    // Limpa o que criou: o resto da suíte conta os admins do A e do B.
    await t.pool.query('DELETE FROM tenant_members WHERE user_uid = ?', [primeiro.body.uid])
  })

  it('vincular admin que falha depois de criar a conta a desfaz: a nova tentativa cria de novo e manda o link de senha', async () => {
    const corpo = { email: 'novo-admin-b@polo-b.com.br', name: 'Novo Admin B' }
    const antes = await contagens()
    falharProximoVinculo()

    const r = await vincularAdmin(w.b.id, corpo)

    expect(r.status).toBe(503)
    expect(await contagens()).toEqual(antes)
    // Sem a limpeza, a conta ficaria no Firebase, a nova tentativa a acharia "já existente" e o link de senha nunca sairia.
    expect(app.fakes.identity.emails.has('novo-admin-b@polo-b.com.br')).toBe(false)
    const linksAntes = app.fakes.identity.resetEmails.length

    const denovo = await vincularAdmin(w.b.id, corpo)
    expect(denovo.status).toBe(201)
    expect(denovo.body).toMatchObject({ email: 'novo-admin-b@polo-b.com.br', existingAccount: false, resetEmailSent: true })
    expect(app.fakes.identity.resetEmails).toHaveLength(linksAntes + 1)
  })

  it('B9: o vínculo gravado antes da falha sai junto com a conta nova: nenhum admin fantasma conta no polo', async () => {
    const membros = app.app.get(TenantMembersService)
    const real = membros.setRoles.bind(membros)
    // O vínculo chega a ser gravado e só então a chamada falha (ex.: a conexão cai depois do commit).
    jest.spyOn(membros, 'setRoles').mockImplementationOnce(async (...args: Parameters<TenantMembersService['setRoles']>) => {
      await real(...args)
      throw new ServiceUnavailableException('Banco indisponível.')
    })
    const antes = await contagens()
    const adminsAntes = (await app.http().get(`/api/platform/tenants/${w.b.id}`).set(comoPlataforma())).body.adminCount
    const r = await vincularAdmin(w.b.id, { email: 'fantasma-b@polo-b.com.br', name: 'Fantasma B' })
    expect(r.status).toBe(503)
    expect(await contagens()).toEqual(antes)
    expect((await app.http().get(`/api/platform/tenants/${w.b.id}`).set(comoPlataforma())).body.adminCount).toBe(adminsAntes)
    expect(app.fakes.identity.emails.has('fantasma-b@polo-b.com.br')).toBe(false)
  })

  it('a plataforma edita nome e marca do polo; o que vier inválido é recusado', async () => {
    const r = await editarPolo(w.b.id, { name: 'Polo B Renomeado', branding: { heroTitle: 'Bem-vindo', accentColor: '#112233' } })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ id: w.b.id, name: 'Polo B Renomeado', slug: 'polo-b', status: 'active' })
    // O resto da marca fica como estava.
    expect(r.body.branding).toMatchObject({ heroTitle: 'Bem-vindo', accentColor: '#112233', primaryColor: '#0055aa', whatsapp: '5541900000000' })
    // O endereço do polo já mostra o nome novo: o cache do host foi limpo.
    expect((await app.http().get('/api/tenant').set('Host', w.b.host)).body).toMatchObject({ name: 'Polo B Renomeado' })
    expect((await editarPolo(w.b.id, { name: 'Polo B' })).body.name).toBe('Polo B')

    for (const invalido of [{ name: 'X' }, { name: null }, { status: null }, { status: 'deleted' }, { branding: null }, { slug: 'outro-endereco' }, { isMatriz: true }]) {
      expect([JSON.stringify(invalido), (await editarPolo(w.b.id, invalido)).status]).toEqual([JSON.stringify(invalido), 400])
    }
    const cor = await editarPolo(w.b.id, { branding: { primaryColor: 'azul' } })
    expect(cor.status).toBe(400)
    expect(mensagem(cor.body)).toContain('Cor principal inválida')
    expect((await editarPolo('nao-existe', { name: 'Fantasma' })).status).toBe(404)
    expect((await app.http().get(`/api/platform/tenants/${w.b.id}`).set(comoPlataforma())).body).toMatchObject({ name: 'Polo B', slug: 'polo-b' })
    // B9: corpo vazio não é edição.
    const vazio = await editarPolo(w.b.id, {})
    expect([vazio.status, vazio.body.message]).toEqual([400, 'Nada para alterar.'])
  })

  it('polo suspenso fecha a loja; a matriz não pode ser suspensa', async () => {
    expect((await editarPolo(w.b.id, { status: 'suspended' })).status).toBe(200)
    const loja = await app.http().get('/api/courses').set('Host', w.b.host)
    expect(loja.status).toBe(403)
    expect(loja.body.code).toBe('TENANT_SUSPENDED')
    expect((await app.http().get('/api/tenant').set('Host', w.b.host)).body.status).toBe('suspended')
    expect((await editarPolo(w.matriz.id, { status: 'suspended' })).status).toBe(400)
    expect((await editarPolo(w.b.id, { status: 'active' })).status).toBe(200)
    expect((await app.http().get('/api/courses').set('Host', w.b.host)).status).toBe(200)
  })

  it('domínio próprio leva ao polo e some ao ser removido', async () => {
    const add = await cadastrarDominio(w.a.id, 'Cursos.PoloA.com.br')
    expect(add.status).toBe(201)
    expect(add.body.domains).toEqual(expect.arrayContaining(['cursos.poloa.com.br', 'polo-a.cursos.studiopilari.com.br']))
    expect((await app.http().get('/api/tenant').set('Host', 'cursos.poloa.com.br')).body.slug).toBe('polo-a')
    expect((await cadastrarDominio(w.b.id, 'cursos.poloa.com.br')).status).toBe(409)
    expect((await cadastrarDominio(w.a.id, 'x.cursos.studiopilari.com.br')).status).toBe(400)
    expect((await cadastrarDominio('nao-existe', 'outro.poloa.com.br')).status).toBe(404)
    // Domínio de um polo não se remove pela porta de outro, nem se remove o que não existe.
    expect((await app.http().delete(`/api/platform/tenants/${w.b.id}/domains/cursos.poloa.com.br`).set(comoPlataforma())).status).toBe(404)
    expect((await app.http().delete(`/api/platform/tenants/${w.a.id}/domains/nao-cadastrado.com.br`).set(comoPlataforma())).status).toBe(404)
    expect((await app.http().delete(`/api/platform/tenants/${w.a.id}/domains/polo-a.cursos.studiopilari.com.br`).set(comoPlataforma())).status).toBe(400)
    // O host chega como o operador digitou (maiúsculas, ponto final); o serviço e o log o normalizam.
    const remove = await removerDominio(w.a.id, 'Cursos.PoloA.COM.br.')
    expect(remove.status).toBe(200)
    expect(remove.body.domains).toEqual(['polo-a.cursos.studiopilari.com.br'])
    expect((await app.http().get('/api/tenant').set('Host', 'cursos.poloa.com.br')).status).toBe(404)
  })

  it('dois cadastros simultâneos do mesmo domínio: um vence e o outro responde 409, nunca 500', async () => {
    const host = 'corrida.poloa.com.br'
    const [r1, r2] = await Promise.all([cadastrarDominio(w.b.id, host), cadastrarDominio(w.b.id, host)])
    expect([r1.status, r2.status].sort()).toEqual([201, 409])
    const perdedora = r1.status === 409 ? r1 : r2
    expect(perdedora.body.message).toBe('Este domínio já está em uso.')
    expect(await consulta('SELECT tenant_id FROM tenant_domains WHERE host = ?', [host])).toEqual([{ tenant_id: w.b.id }])
    expect((await removerDominio(w.b.id, host)).status).toBe(200)
  })

  it('endereços com tratamento especial na resolução não viram domínio de polo, e a matriz continua no fallback', async () => {
    const especiais = ['pilari-academy-abc-uc.a.run.app', 'x.run.app', '127.0.0.1', '192.168.0.10', '[::1]', 'x.localhost', 'x.test']
    for (const host of especiais) {
      const r = await cadastrarDominio(w.a.id, host)
      expect([host, r.status, r.body.message]).toEqual([host, 400, 'Domínio inválido.'])
    }
    expect(await consulta('SELECT host FROM tenant_domains WHERE tenant_id = ? AND is_primary = 0', [w.a.id])).toEqual([])
    // A URL padrão do Cloud Run segue caindo na matriz, não no polo A.
    const cloudRun = await app.http().get('/api/tenant').set('Host', 'pilari-academy-abc-uc.a.run.app')
    expect(cloudRun.status).toBe(200)
    expect(cloudRun.body).toMatchObject({ isMatriz: true })
  })

  it('a plataforma pede upload da marca de qualquer polo; polo inexistente responde 404', async () => {
    const ok = await app.http().post(`/api/platform/tenants/${w.b.id}/upload-url`).set(comoPlataforma()).send({ kind: 'logo', fileName: 'l.png', contentType: 'image/png' })
    expect(ok.status).toBe(201)
    expect(ok.body.objectPath).toMatch(new RegExp(`^polos/${w.b.id}/marca/`))
    expect(ok.body.uploadUrl).toContain(ok.body.objectPath)
    expect((await app.http().post('/api/platform/tenants/nao-existe/upload-url').set(comoPlataforma()).send({ kind: 'logo', fileName: 'l.png', contentType: 'image/png' })).status).toBe(404)
    // Só imagem inerte e só os três tipos de arquivo da marca.
    expect((await app.http().post(`/api/platform/tenants/${w.b.id}/upload-url`).set(comoPlataforma()).send({ kind: 'logo', fileName: 'l.svg', contentType: 'image/svg+xml' })).status).toBe(400)
    expect((await app.http().post(`/api/platform/tenants/${w.b.id}/upload-url`).set(comoPlataforma()).send({ kind: 'banner', fileName: 'l.png', contentType: 'image/png' })).status).toBe(400)
  })

  it('B6: as ações do console ficam no log do polo afetado e no da rede, com o nome do polo no resumo', async () => {
    const esperadas = ['tenant.admin-add', 'tenant.create', 'tenant.domain-add', 'tenant.domain-remove', 'tenant.update']
    const linhas = await eventually(
      () => consulta<{ action: string; tenant_id: string | null; actor_uid: string | null; target_id: string | null; summary: string }>(
        "SELECT action, tenant_id, actor_uid, target_id, summary FROM audit_logs WHERE action LIKE 'tenant.%'"
      ),
      (v) => esperadas.every((a) => v.some((l) => l.action === a))
    )
    expect([...new Set(linhas.map((l) => l.action))].sort()).toEqual(esperadas)
    // Gravada no polo afetado (o alvo), pela plataforma.
    for (const l of linhas) {
      expect([l.action, l.tenant_id, l.actor_uid]).toEqual([l.action, l.target_id, w.u.platform])
    }
    // O resumo leva o nome do polo, nunca o id.
    for (const l of linhas) expect([l.action, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/.test(l.summary)]).toEqual([l.action, false])
    expect(linhas.filter((l) => l.action === 'tenant.admin-add').map((l) => l.summary)).toContain('Vinculou u-prof-a@teste.local como admin do polo Polo A')
    // O log de criação aponta para o polo criado.
    const [novo] = await consulta<{ id: string }>("SELECT id FROM tenants WHERE slug = 'polo-novo'")
    expect(linhas.some((l) => l.action === 'tenant.create' && l.target_id === novo.id && l.tenant_id === novo.id)).toBe(true)
    // Recusas não deixam rastro de sucesso: o polo que não foi criado não tem log de criação.
    expect(await consulta("SELECT id FROM audit_logs WHERE action = 'tenant.create' AND summary LIKE '%polo-orfao%'")).toEqual([])
    // A tentativa desfeita não deixa log de criação: cada polo das falhas tem UM, o da nova tentativa, que deu certo.
    for (const slug of ['polo-falha', 'polo-falha-b', 'polo-falha-c']) {
      expect([slug, (await consulta("SELECT id FROM audit_logs WHERE action = 'tenant.create' AND summary LIKE ?", [`%(${slug})%`])).length]).toEqual([slug, 1])
    }
    // O resumo mostra o domínio como ficou gravado (minúsculo, sem ponto final), não como o operador o digitou
    // ('Cursos.PoloA.com.br' no cadastro e 'Cursos.PoloA.COM.br.' na remoção).
    const dominios = await consulta<{ summary: string }>(
      "SELECT summary FROM audit_logs WHERE action IN ('tenant.domain-add', 'tenant.domain-remove') AND summary LIKE '%poloa.com.br%' ORDER BY summary"
    )
    expect(dominios.map((l) => l.summary)).toEqual([
      'Cadastrou o domínio corrida.poloa.com.br no polo Polo B',
      'Cadastrou o domínio cursos.poloa.com.br no polo Polo A',
      'Removeu o domínio corrida.poloa.com.br do polo Polo B',
      'Removeu o domínio cursos.poloa.com.br do polo Polo A',
    ])
    // O admin do polo A vê na tela de logs dele o que a plataforma fez no A, e só no A.
    const logsA = await app.http().get('/api/admin/logs').set('Host', w.a.host).set('Authorization', bearer(w.u.adminA))
    expect(logsA.status).toBe(200)
    const doConsoleNoA = (logsA.body.logs as Array<{ action: string; targetId: string }>).filter((l) => l.action.startsWith('tenant.'))
    expect(doConsoleNoA.map((l) => l.action)).toEqual(expect.arrayContaining(['tenant.admin-add', 'tenant.domain-add', 'tenant.domain-remove']))
    expect(doConsoleNoA.every((l) => l.targetId === w.a.id)).toBe(true)
    // E a rede (logs do console) mostra as mesmas linhas com o nome do polo.
    const rede = await app.http().get('/api/platform/logs').set(comoPlataforma())
    expect((rede.body.logs as Array<{ action: string; tenantName: string | null }>).some((l) => l.action === 'tenant.admin-add' && l.tenantName === 'Polo A')).toBe(true)
  })
})
