import { randomUUID } from 'node:crypto'
import { BadRequestException } from '@nestjs/common'
import { Role } from '@pilari/types'
import type { Actor } from '../../src/common/types/actor.type'
import { AuthService } from '../../src/modules/auth/auth.service'
import { TenantMembersService } from '../../src/modules/tenancy/tenant-members.service'
import { bootTestApp, type TestApp } from './helpers/app'
import { createTestDatabase, type TestDatabase } from './helpers/db'
import { bearer, seedCourse, seedEnrollment, seedMember, seedTenant, seedTwoPolos, seedUser, type TwoPolos } from './helpers/seed'
import { eventually } from './helpers/wait'

interface LinhaUsuario {
  uid: string
  email: string
  roles: string[]
}

const MSG_COMPARTILHADA =
  'Esta pessoa também está ligada a outro polo da rede. Nome e CPF vão para os certificados de todos os polos dela; quem corrige é o Studio Pilari.'

describe('usuários, alunos e cortesia por polo', () => {
  let t: TestDatabase
  let app: TestApp
  let w: TwoPolos

  beforeAll(async () => {
    t = await createTestDatabase()
    app = await bootTestApp(t.url)
    w = await seedTwoPolos(t)
    await seedUser(t, { uid: 'u-so-do-a' })
    await seedMember(t, w.a.id, 'u-so-do-a', ['student'])
    app.fakes.identity.emails.set('u-aluno-b@teste.local', w.u.studentB)
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

  const comoAdminA = () => ({ Host: w.a.host, Authorization: bearer(w.u.adminA) })
  const como = (host: string, uid: string) => ({ Host: host, Authorization: bearer(uid) })
  const consulta = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => (await t.pool.query(sql, params))[0] as T[]
  const vinculoDe = (tenantId: string, uid: string) =>
    consulta<{ roles: string[] }>('SELECT roles FROM tenant_members WHERE tenant_id = ? AND user_uid = ?', [tenantId, uid])
  const uidsDaLista = async (headers: Record<string, string>): Promise<string[]> =>
    ((await app.http().get('/api/admin/users').set(headers)).body.users as LinhaUsuario[]).map((u) => u.uid).sort()

  // Os testes dependem da ordem: o mundo semeado vai mudando (aluno vinculado, cortesia dada,
  // nome corrigido). Os que só leem vêm antes dos que gravam, e cada gravação usa gente própria.

  it('a lista de usuários é só dos membros do polo', async () => {
    const r = await app.http().get('/api/admin/users').set(comoAdminA())
    const uids = (r.body.users as Array<{ uid: string }>).map((u) => u.uid).sort()
    expect(uids).toEqual([w.u.adminA, w.u.studentA, w.u.teacherA, 'u-compartilhado', 'u-so-do-a'].sort())
  })

  it('a lista pagina e busca só entre os membros do polo, com os papéis do polo', async () => {
    const pagina = async (query: Record<string, string | number>, headers: Record<string, string> = comoAdminA()) =>
      (await app.http().get('/api/admin/users').query(query).set(headers)).body as { users: LinhaUsuario[]; total: number }
    // Ordenada por e-mail: u-adm-a, u-aluno-a, u-compartilhado, u-prof-a, u-so-do-a.
    const p1 = await pagina({ page: 1, pageSize: 2 })
    expect(p1.total).toBe(5)
    expect(p1.users.map((u) => [u.uid, u.roles])).toEqual([[w.u.adminA, ['admin']], [w.u.studentA, ['student']]])
    expect((await pagina({ page: 2, pageSize: 2 })).users.map((u) => [u.uid, u.roles])).toEqual([['u-compartilhado', ['student']], [w.u.teacherA, ['teacher']]])
    expect((await pagina({ page: 3, pageSize: 2 })).users.map((u) => u.uid)).toEqual(['u-so-do-a'])
    // A busca olha e-mail e nome, e só dentro do polo: o aluno do B existe na rede, mas não aparece aqui.
    expect(await pagina({ q: 'compartilhado' })).toMatchObject({ total: 1, users: [{ uid: 'u-compartilhado' }] })
    expect((await pagina({ q: 'Usuário u-prof' })).users.map((u) => u.uid)).toEqual([w.u.teacherA]) // só o nome casa
    expect((await pagina({ q: 'aluno-b' })).total).toBe(0)
    expect((await pagina({ q: '%' })).total).toBe(0) // o curinga do LIKE é escapado, senão casaria todos
    // O total acompanha a busca, e cada polo e a plataforma enxergam a lista do polo do endereço.
    const doB = [w.u.adminB, w.u.studentB, w.u.teacherB, 'u-compartilhado'].sort()
    expect(await uidsDaLista(como(w.b.host, w.u.adminB))).toEqual(doB)
    expect(await uidsDaLista(como(w.b.host, w.u.platform))).toEqual(doB)
    // A matriz, que antes era "a rede inteira", também lista só os próprios membros.
    expect(await uidsDaLista(como(w.matriz.host, w.u.adminMatriz))).toEqual([w.u.adminMatriz])
    expect((await app.http().get('/api/admin/users').query({ pageSize: 500 }).set(comoAdminA())).status).toBe(400)
  })

  it('o perfil do membro traz CPF, status e os papéis do polo', async () => {
    const r = await app.http().get('/api/admin/users/u-so-do-a').set(comoAdminA())
    expect(r.status).toBe(200)
    expect(r.body.user).toMatchObject({
      uid: 'u-so-do-a', email: 'u-so-do-a@teste.local', displayName: 'Usuário u-so-do-a', roles: ['student'], cpf: null, disabled: false, isPlatformAdmin: false,
    })
    expect(r.body.user.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('perfil de quem não é do polo responde 404', async () => {
    expect((await app.http().get(`/api/admin/users/${w.u.studentB}`).set(comoAdminA())).status).toBe(404)
  })

  it('aluno compartilhado só é corrigido pela plataforma', async () => {
    const negado = await app.http().patch(`/api/admin/users/${w.u.shared}`).set(comoAdminA()).send({ displayName: 'Nome Corrigido' })
    expect(negado.status).toBe(403)
    expect(negado.body.code).toBe('SHARED_USER_PLATFORM_ONLY')
    const ok = await app.http().patch(`/api/admin/users/${w.u.shared}`).set('Host', w.a.host).set('Authorization', bearer(w.u.platform)).send({ displayName: 'Nome Corrigido' })
    expect(ok.status).toBe(200)
  })

  it('a recusa ao aluno compartilhado vale para o CPF e para o admin de qualquer dos polos, e não grava nada; a plataforma corrige de qualquer endereço', async () => {
    const ler = async () => (await consulta<{ display_name: string | null; cpf: string | null }>('SELECT display_name, cpf FROM users WHERE uid = ?', [w.u.shared]))[0]
    const antes = await ler()
    for (const headers of [comoAdminA(), como(w.b.host, w.u.adminB)]) {
      const r = await app.http().patch(`/api/admin/users/${w.u.shared}`).set(headers).send({ cpf: '529.982.247-25' })
      expect([r.status, r.body.code]).toEqual([403, 'SHARED_USER_PLATFORM_ONLY'])
      expect(r.body.message).toBe(MSG_COMPARTILHADA)
    }
    expect(await ler()).toEqual(antes)
    const ok = await app.http().patch(`/api/admin/users/${w.u.shared}`).set(como(w.b.host, w.u.platform)).send({ cpf: '529.982.247-25' })
    expect(ok.status).toBe(200)
    expect(ok.body.user).toMatchObject({ uid: w.u.shared, cpf: '52998224725', roles: ['student'] })
    expect(await ler()).toEqual({ ...antes, cpf: '52998224725' })
  })

  it('aluno só deste polo é corrigido pelo admin do polo', async () => {
    expect((await app.http().patch('/api/admin/users/u-so-do-a').set(comoAdminA()).send({ displayName: 'Aluno Do A' })).status).toBe(200)
  })

  it('o admin do polo corrige também o CPF do aluno só dele; CPF inválido é recusado sem gravar', async () => {
    const ruim = await app.http().patch('/api/admin/users/u-so-do-a').set(comoAdminA()).send({ cpf: '123.456.789-00' })
    expect(ruim.status).toBe(400)
    expect(await consulta('SELECT cpf FROM users WHERE uid = ?', ['u-so-do-a'])).toEqual([{ cpf: null }])
    const ok = await app.http().patch('/api/admin/users/u-so-do-a').set(comoAdminA()).send({ cpf: '529.982.247-25' })
    expect(ok.status).toBe(200)
    expect(ok.body.user).toMatchObject({ uid: 'u-so-do-a', displayName: 'Aluno Do A', cpf: '52998224725', roles: ['student'] })
    expect(await consulta('SELECT cpf FROM users WHERE uid = ?', ['u-so-do-a'])).toEqual([{ cpf: '52998224725' }])
  })

  it('CA-6: compartilhada é quem tem matrícula, certificado ou papel de equipe em outro polo; visitar o site de outro polo não conta', async () => {
    for (const uid of ['u-visita', 'u-mat-b', 'u-cert-b', 'u-equipe-b']) {
      await seedUser(t, { uid })
      await seedMember(t, w.a.id, uid, ['student'])
    }
    // Visita: o login no site do B cria o vínculo de aluno lá, e só isso.
    expect((await app.http().post('/api/auth/sync-user-data').set(como(w.b.host, 'u-visita')).send({})).status).toBe(201)
    expect(await vinculoDe(w.b.id, 'u-visita')).toEqual([{ roles: ['student'] }])
    // Matrícula num curso do B, em qualquer situação (aqui, cancelada).
    await seedMember(t, w.b.id, 'u-mat-b', ['student'])
    await seedEnrollment(t, { userId: 'u-mat-b', courseId: w.courses.b.id, status: 'canceled' })
    // Certificado de um curso do B, sem vínculo nem matrícula no B.
    await t.pool.query(
      'INSERT INTO certificates (id, user_id, course_id, code, student_name, course_title, hours, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [randomUUID(), 'u-cert-b', w.courses.b.id, randomUUID(), 'Usuário u-cert-b', 'Excel do Polo B', 10, 'issued']
    )
    // Papel de equipe no B.
    await seedMember(t, w.b.id, 'u-equipe-b', ['teacher'])

    const corrigirPeloA = (uid: string) => app.http().patch(`/api/admin/users/${uid}`).set(comoAdminA()).send({ displayName: 'Nome Pelo Polo A' })
    expect((await corrigirPeloA('u-visita')).status).toBe(200)
    for (const uid of ['u-mat-b', 'u-cert-b', 'u-equipe-b']) {
      const r = await corrigirPeloA(uid)
      expect([uid, r.status, r.body.code, r.body.message]).toEqual([uid, 403, 'SHARED_USER_PLATFORM_ONLY', MSG_COMPARTILHADA])
      expect(await consulta('SELECT display_name FROM users WHERE uid = ?', [uid])).toEqual([{ display_name: `Usuário ${uid}` }])
    }
    // Visto do B, quem só tem o vínculo de aluno no A (sem matrícula, certificado nem papel de equipe lá) é exclusivo do B.
    expect((await app.http().patch('/api/admin/users/u-visita').set(como(w.b.host, w.u.adminB)).send({ displayName: 'Nome Pelo Polo B' })).status).toBe(200)
  })

  it('B2: o CPF da pessoa compartilhada sai mascarado para o polo; o polo que a tem só para si e a plataforma veem inteiro', async () => {
    await seedUser(t, { uid: 'u-cpf-b', cpf: '52998224725' })
    await seedMember(t, w.b.id, 'u-cpf-b', ['student'])
    await seedEnrollment(t, { userId: 'u-cpf-b', courseId: w.courses.b.id })
    app.fakes.identity.emails.set('u-cpf-b@teste.local', 'u-cpf-b')
    // O admin do A vincula pelo e-mail (a resposta do vínculo não traz CPF).
    const vinculo = await app.http().post('/api/admin/users').set(comoAdminA())
      .send({ email: 'u-cpf-b@teste.local', displayName: 'Outro Nome', password: 'segredo123', roles: ['student'] })
    expect([vinculo.status, vinculo.body.existingAccount]).toEqual([201, true])
    expect(JSON.stringify(vinculo.body)).not.toContain('52998224725')
    // Visto do A ela é compartilhada (matrícula no B): a mesma máscara do documento público do certificado.
    const doA = await app.http().get('/api/admin/users/u-cpf-b').set(comoAdminA())
    expect([doA.status, doA.body.user.cpf]).toEqual([200, '***.***.***-**'])
    expect(JSON.stringify(doA.body)).not.toContain('52998224725')
    // Visto do B, o vínculo de aluno que o A criou já é vínculo em outro polo (definição ampla, a do CPF e da senha): o B
    // também passa a ver a máscara. Para corrigir o nome, vale a definição estrita (CA-6), e o B continua corrigindo.
    expect((await app.http().get('/api/admin/users/u-cpf-b').set(como(w.b.host, w.u.adminB))).body.user.cpf).toBe('***.***.***-**')
    // A plataforma vê tudo, de qualquer endereço.
    expect((await app.http().get('/api/admin/users/u-cpf-b').set(como(w.a.host, w.u.platform))).body.user.cpf).toBe('52998224725')
    // A lista não traz CPF de ninguém.
    expect(JSON.stringify((await app.http().get('/api/admin/users').set(comoAdminA())).body)).not.toContain('52998224725')
  })

  it('conta que só visitou outro site (vínculo passivo na matriz, CPF de um checkout abandonado): o polo que a vincula vê o CPF mascarado e não redefine a senha, mas corrige o nome', async () => {
    await seedUser(t, { uid: 'u-visitou-matriz', cpf: '52998224725' })
    await seedMember(t, w.matriz.id, 'u-visitou-matriz', ['student']) // o login no site da matriz criou o vínculo
    await seedMember(t, w.a.id, 'u-visitou-matriz', ['student']) // o polo A a vinculou pelo e-mail
    const detalhe = await app.http().get('/api/admin/users/u-visitou-matriz').set(comoAdminA())
    expect([detalhe.status, detalhe.body.user.cpf]).toEqual([200, '***.***.***-**'])
    expect(JSON.stringify(detalhe.body)).not.toContain('52998224725')

    const envios = app.fakes.identity.resetEmails.length
    const revogar = jest.spyOn(app.fakes.identity, 'revokeTokens')
    const senha = await app.http().post('/api/admin/users/u-visitou-matriz/password-reset').set(comoAdminA())
    expect([senha.status, senha.body.code]).toEqual([403, 'SHARED_USER_PLATFORM_ONLY'])
    expect(app.fakes.identity.resetEmails).toHaveLength(envios)
    expect(revogar).not.toHaveBeenCalled()
    revogar.mockRestore()

    // Sem relação real fora do A (matrícula, certificado ou papel de equipe), corrigir o nome continua com o polo.
    const nome = await app.http().patch('/api/admin/users/u-visitou-matriz').set(comoAdminA()).send({ displayName: 'Nome Corrigido Pelo A' })
    expect(nome.status).toBe(200)
    // A plataforma vê o documento inteiro.
    expect((await app.http().get('/api/admin/users/u-visitou-matriz').set(como(w.a.host, w.u.platform))).body.user.cpf).toBe('52998224725')
  })

  it('o admin não se rebaixa e o polo não fica sem admin', async () => {
    expect((await app.http().patch(`/api/admin/users/${w.u.adminA}/roles`).set(comoAdminA()).send({ roles: ['teacher'] })).status).toBe(400)
  })

  it('trocar papéis vale na próxima chamada: muda o vínculo do polo, não a coluna global nem as sessões', async () => {
    const revogar = jest.spyOn(app.fakes.identity, 'revokeTokens')
    const r = await app.http().patch('/api/admin/users/u-so-do-a/roles').set(comoAdminA()).send({ roles: ['teacher', 'student'] })
    expect(r.status).toBe(200)
    expect(r.body.user).toMatchObject({ uid: 'u-so-do-a', roles: ['teacher', 'student'] })
    expect(await vinculoDe(w.a.id, 'u-so-do-a')).toEqual([{ roles: ['teacher', 'student'] }])
    expect(await consulta('SELECT roles FROM users WHERE uid = ?', ['u-so-do-a'])).toEqual([{ roles: ['student'] }])
    expect(revogar).not.toHaveBeenCalled()
    // Mesmo token, sem login novo: no A a pessoa já é professora; no B continua sem papel nenhum.
    expect((await app.http().get('/api/auth/me').set(como(w.a.host, 'u-so-do-a'))).body.roles).toEqual(['teacher', 'student'])
    expect((await app.http().get('/api/auth/me').set(como(w.b.host, 'u-so-do-a'))).body.roles).toEqual([])
    // A ação fica no log do polo do endereço.
    const logs = await eventually(
      async () => consulta<{ tenant_id: string; actor_uid: string }>("SELECT tenant_id, actor_uid FROM audit_logs WHERE action = 'user.roles' AND target_id = ?", ['u-so-do-a']),
      (v) => v.length > 0
    )
    expect(logs).toEqual([{ tenant_id: w.a.id, actor_uid: w.u.adminA }])
    // Volta ao que era, para o resto da suíte.
    const volta = await app.http().patch('/api/admin/users/u-so-do-a/roles').set(comoAdminA()).send({ roles: ['student'] })
    expect(volta.body.user.roles).toEqual(['student'])
  })

  it('campo que não existe no corpo é recusado em português, no formato de sempre (B5)', async () => {
    const r = await app.http().post('/api/admin/users').set(comoAdminA())
      .send({ email: 'campo.extra@teste.local', displayName: 'Campo Extra', password: 'segredo123', roles: ['student'], tenantId: 'outro-polo' })
    expect([r.status, r.body.error, r.body.message]).toEqual([400, 'Bad Request', ['O campo tenantId não é aceito.']])
    expect(app.fakes.identity.emails.has('campo.extra@teste.local')).toBe(false)
  })

  it('papel inexistente ou lista vazia é recusado sem gravar nada', async () => {
    for (const roles of [['superuser'], []]) {
      expect((await app.http().patch('/api/admin/users/u-so-do-a/roles').set(comoAdminA()).send({ roles })).status).toBe(400)
    }
    expect(await vinculoDe(w.a.id, 'u-so-do-a')).toEqual([{ roles: ['student'] }])
  })

  it('o admin de um polo não vê nem mexe em quem não é do polo dele: tudo responde 404 e o banco não muda', async () => {
    const vinculos = (uid: string) => consulta('SELECT * FROM tenant_members WHERE user_uid = ?', [uid])
    const cursoDeA = w.courses.a.id
    const casos = [
      // admin do B sobre aluno que é só do A
      { headers: como(w.b.host, w.u.adminB), alvo: w.u.studentA, curso: cursoDeA },
      // admin do A sobre professor que é só do B
      { headers: comoAdminA(), alvo: w.u.teacherB, curso: w.courses.b.id },
    ]
    for (const { headers, alvo, curso } of casos) {
      const antes = await vinculos(alvo)
      const nomeAntes = await consulta('SELECT display_name FROM users WHERE uid = ?', [alvo])
      expect((await app.http().get(`/api/admin/users/${alvo}`).set(headers)).status).toBe(404)
      expect((await app.http().patch(`/api/admin/users/${alvo}`).set(headers).send({ displayName: 'Nome do Intruso' })).status).toBe(404)
      expect((await app.http().patch(`/api/admin/users/${alvo}/roles`).set(headers).send({ roles: ['admin'] })).status).toBe(404)
      expect((await app.http().post(`/api/admin/users/${alvo}/password-reset`).set(headers)).status).toBe(404)
      // O curso é do outro polo: não existe aqui, então nem a cortesia nem a retirada passam.
      expect((await app.http().post(`/api/admin/users/${alvo}/enrollments`).set(headers).send({ courseId: curso })).status).toBe(404)
      expect((await app.http().delete(`/api/admin/users/${alvo}/enrollments/${curso}`).set(headers)).status).toBe(404)
      expect(await vinculos(alvo)).toEqual(antes)
      expect(await consulta('SELECT display_name FROM users WHERE uid = ?', [alvo])).toEqual(nomeAntes)
    }
    expect(app.fakes.identity.resetEmails).toEqual([])
    expect(await consulta('SELECT status FROM enrollments WHERE user_id = ? AND course_id = ?', [w.u.studentA, cursoDeA])).toEqual([{ status: 'active' }])
    expect(await consulta('SELECT status FROM enrollments WHERE user_id = ? AND course_id = ?', [w.u.teacherB, w.courses.b.id])).toEqual([])
  })

  it('cadastrar e-mail que já tem conta na rede só vincula ao polo', async () => {
    const r = await app.http().post('/api/admin/users').set(comoAdminA()).send({ email: 'u-aluno-b@teste.local', displayName: 'Outro Nome', password: 'segredo123', roles: ['student'] })
    expect(r.status).toBe(201)
    expect(r.body.existingAccount).toBe(true)
    const [nome] = await t.pool.query('SELECT display_name FROM users WHERE uid = ?', [w.u.studentB])
    expect(nome).toEqual([{ display_name: `Usuário ${w.u.studentB}` }])
  })

  it('quem já foi vinculado ao polo não é cadastrado de novo: 409, também com o e-mail em maiúsculas', async () => {
    for (const email of ['u-aluno-b@teste.local', 'U-ALUNO-B@TESTE.LOCAL']) {
      const r = await app.http().post('/api/admin/users').set(comoAdminA()).send({ email, displayName: 'Outro Nome', password: 'segredo123', roles: ['admin'] })
      expect([r.status, r.body.message]).toEqual([409, 'Esta pessoa já faz parte do polo. Altere os papéis na lista de usuários.'])
    }
    // O pedido recusado não deu o papel de admin a ninguém.
    expect(await vinculoDe(w.a.id, w.u.studentB)).toEqual([{ roles: ['student'] }])
  })

  it('cadastrar e-mail novo cria conta, cadastro e vínculo só neste polo, e a ação fica no log do polo', async () => {
    const email = 'professora.nova@teste.local'
    const r = await app.http().post('/api/admin/users').set(comoAdminA()).send({ email: 'Professora.Nova@Teste.Local', displayName: 'Professora Nova', password: 'segredo123', roles: ['teacher'] })
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ existingAccount: false, user: { email, displayName: 'Professora Nova', roles: ['teacher'] } })
    const uid = r.body.user.uid as string
    expect(app.fakes.identity.emails.get(email)).toBe(uid) // a conta nasceu com o e-mail em minúsculas
    expect(await consulta('SELECT email, display_name FROM users WHERE uid = ?', [uid])).toEqual([{ email, display_name: 'Professora Nova' }])
    expect(await consulta('SELECT tenant_id, roles FROM tenant_members WHERE user_uid = ?', [uid])).toEqual([{ tenant_id: w.a.id, roles: ['teacher'] }])
    expect(await uidsDaLista(comoAdminA())).toContain(uid)
    expect(await uidsDaLista(como(w.b.host, w.u.adminB))).not.toContain(uid)
    const logs = await eventually(
      async () => consulta<{ tenant_id: string; actor_uid: string; summary: string }>("SELECT tenant_id, actor_uid, summary FROM audit_logs WHERE action = 'user.create' AND target_id = ?", [uid]),
      (v) => v.length > 0
    )
    expect(logs).toEqual([{ tenant_id: w.a.id, actor_uid: w.u.adminA, summary: `Criou ${email} com papéis teacher` }])
  })

  it('vincular quem tem papel em outro polo dá só os papéis pedidos aqui: o outro polo, o nome e a conta seguem como estavam', async () => {
    const criar = jest.spyOn(app.fakes.identity, 'createIdentity')
    app.fakes.identity.emails.set('u-prof-b@teste.local', w.u.teacherB)
    const r = await app.http().post('/api/admin/users').set(comoAdminA()).send({ email: 'u-prof-b@teste.local', displayName: 'Nome Que Não Vale', password: 'senha-que-nao-vale', roles: ['student'] })
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ existingAccount: true, user: { uid: w.u.teacherB, displayName: `Usuário ${w.u.teacherB}`, roles: ['student'] } })
    expect(criar).not.toHaveBeenCalled()
    expect(await vinculoDe(w.a.id, w.u.teacherB)).toEqual([{ roles: ['student'] }])
    expect(await vinculoDe(w.b.id, w.u.teacherB)).toEqual([{ roles: ['teacher'] }])
    expect(await consulta('SELECT display_name FROM users WHERE uid = ?', [w.u.teacherB])).toEqual([{ display_name: `Usuário ${w.u.teacherB}` }])
    // Cada polo mostra o papel que a pessoa tem nele.
    expect((await app.http().get(`/api/admin/users/${w.u.teacherB}`).set(comoAdminA())).body.user.roles).toEqual(['student'])
    expect((await app.http().get(`/api/admin/users/${w.u.teacherB}`).set(como(w.b.host, w.u.adminB))).body.user.roles).toEqual(['teacher'])
    // E como é professora no B (papel de equipe em outro polo), o admin do A não corrige o nome dela.
    const bloqueado = await app.http().patch(`/api/admin/users/${w.u.teacherB}`).set(comoAdminA()).send({ displayName: 'Professora Outra' })
    expect([bloqueado.status, bloqueado.body.code]).toEqual([403, 'SHARED_USER_PLATFORM_ONLY'])
  })

  it('cortesia de curso de outro polo responde 404; do polo, vincula o aluno', async () => {
    expect((await app.http().post(`/api/admin/users/${w.u.studentA}/enrollments`).set(comoAdminA()).send({ courseId: w.courses.b.id })).status).toBe(404)
    await seedUser(t, { uid: 'u-novo' })
    expect((await app.http().post('/api/admin/users/u-novo/enrollments').set(comoAdminA()).send({ courseId: w.courses.a.id })).status).toBe(201)
    const [rows] = await t.pool.query('SELECT roles FROM tenant_members WHERE tenant_id = ? AND user_uid = ?', [w.a.id, 'u-novo'])
    expect(rows).toEqual([{ roles: ['student'] }])
  })

  it('as matrículas listadas são só dos cursos do polo do endereço', async () => {
    const titulos = async (headers: Record<string, string>) =>
      ((await app.http().get(`/api/admin/users/${w.u.shared}/enrollments`).set(headers)).body.enrollments as Array<{ courseTitle: string }>).map((e) => e.courseTitle)
    expect(await titulos(comoAdminA())).toEqual(['Excel do Polo A'])
    expect(await titulos(como(w.b.host, w.u.adminB))).toEqual(['Excel do Polo B'])
    expect((await app.http().get('/api/admin/users/u-novo/enrollments').set(comoAdminA())).body.enrollments).toEqual([
      { courseId: w.courses.a.id, courseTitle: 'Excel do Polo A', courseSlug: 'excel-basico', status: 'active', source: 'free' },
    ])
  })

  it('retirar a cortesia apaga só a matrícula do curso do polo; a do outro polo fica, e a pessoa continua no polo', async () => {
    const matriculas = (uid: string, courseId: string) => consulta('SELECT status FROM enrollments WHERE user_id = ? AND course_id = ?', [uid, courseId])
    const recusado = await app.http().delete(`/api/admin/users/${w.u.shared}/enrollments/${w.courses.b.id}`).set(comoAdminA())
    expect(recusado.status).toBe(404)
    expect(await matriculas(w.u.shared, w.courses.b.id)).toEqual([{ status: 'active' }])
    const ok = await app.http().delete(`/api/admin/users/u-novo/enrollments/${w.courses.a.id}`).set(comoAdminA())
    expect([ok.status, ok.body]).toEqual([200, { ok: true }])
    expect(await matriculas('u-novo', w.courses.a.id)).toEqual([])
    expect(await vinculoDe(w.a.id, 'u-novo')).toEqual([{ roles: ['student'] }])
    // O aluno que estuda nos dois polos perde só o curso do A: o do B, que não é do admin do A, fica.
    const doA = await app.http().delete(`/api/admin/users/${w.u.shared}/enrollments/${w.courses.a.id}`).set(comoAdminA())
    expect(doA.status).toBe(200)
    expect(await matriculas(w.u.shared, w.courses.a.id)).toEqual([])
    expect(await matriculas(w.u.shared, w.courses.b.id)).toEqual([{ status: 'active' }])
    // Retirar libera o par único: dá para conceder de novo, e a matrícula volta a aparecer na lista.
    const deNovo = await app.http().post(`/api/admin/users/${w.u.shared}/enrollments`).set(comoAdminA()).send({ courseId: w.courses.a.id })
    expect(deNovo.status).toBe(201)
    expect(await matriculas(w.u.shared, w.courses.a.id)).toEqual([{ status: 'active' }])
  })

  it('conceder de novo reativa a matrícula cancelada sem duplicar; já ativa é 400; usuário que não existe é 404', async () => {
    await seedUser(t, { uid: 'u-cancelado' })
    const idAntigo = await seedEnrollment(t, { userId: 'u-cancelado', courseId: w.courses.a.id, status: 'canceled', source: 'purchase' })
    const conceder = (uid: string) => app.http().post(`/api/admin/users/${uid}/enrollments`).set(comoAdminA()).send({ courseId: w.courses.a.id })
    const r = await conceder('u-cancelado')
    expect(r.status).toBe(201)
    expect(r.body.enrollment).toEqual({ courseId: w.courses.a.id, courseTitle: 'Excel do Polo A', courseSlug: 'excel-basico', status: 'active', source: 'free' })
    expect(await consulta('SELECT id, status, source FROM enrollments WHERE user_id = ?', ['u-cancelado'])).toEqual([{ id: idAntigo, status: 'active', source: 'free' }])
    expect(await vinculoDe(w.a.id, 'u-cancelado')).toEqual([{ roles: ['student'] }])
    const repetido = await conceder('u-cancelado')
    expect([repetido.status, repetido.body.message]).toEqual([400, 'O aluno já tem acesso a este curso.'])
    const fantasma = await conceder('u-que-nao-existe')
    expect([fantasma.status, fantasma.body.message]).toEqual([404, 'Usuário não encontrado.'])
  })

  it('a cortesia a quem já tem papel no polo não rebaixa nem troca os papéis dele', async () => {
    const r = await app.http().post(`/api/admin/users/${w.u.teacherA}/enrollments`).set(comoAdminA()).send({ courseId: w.courses.a.id })
    expect(r.status).toBe(201)
    expect(await vinculoDe(w.a.id, w.u.teacherA)).toEqual([{ roles: ['teacher'] }])
  })

  it('reset de senha de quem não é do polo responde 404', async () => {
    expect((await app.http().post(`/api/admin/users/${w.u.adminB}/password-reset`).set(comoAdminA())).status).toBe(404)
  })

  it('reset de senha de membro do polo manda o link ao titular', async () => {
    const r = await app.http().post(`/api/admin/users/${w.u.studentA}/password-reset`).set(comoAdminA())
    expect([r.status, r.body]).toEqual([201, { ok: true }])
    expect(app.fakes.identity.resetEmails).toEqual([`${w.u.studentA}@teste.local`])
  })

  it('o último admin do polo não sai pela regra do serviço (contra o MySQL real); a plataforma pode', async () => {
    const polo = await seedTenant(t, { slug: 'polo-c', name: 'Polo C' })
    await seedUser(t, { uid: 'c-adm-1' })
    await seedUser(t, { uid: 'c-adm-2' })
    await seedMember(t, polo.id, 'c-adm-1', ['admin'])
    await seedMember(t, polo.id, 'c-adm-2', ['teacher'])
    const auth = new AuthService(t.db, new TenantMembersService(t.db))
    const doPolo: Actor = { uid: 'quem-pede', tenantId: polo.id, isMatriz: false, isAdmin: true, isPlatformAdmin: false }
    const plataforma: Actor = { ...doPolo, uid: 'plat', isPlatformAdmin: true }
    const papeis = async (uid: string) => (await vinculoDe(polo.id, uid))[0]?.roles
    // c-adm-1 é o único admin do C, mesmo com admins de sobra nos outros polos: não sai.
    await expect(auth.setTenantRoles(doPolo, 'c-adm-1', [Role.teacher])).rejects.toThrow('O polo precisa de ao menos um admin.')
    expect(await papeis('c-adm-1')).toEqual(['admin'])
    // Com um segundo admin no polo, o primeiro pode sair.
    await auth.setTenantRoles(doPolo, 'c-adm-2', [Role.admin])
    await auth.setTenantRoles(doPolo, 'c-adm-1', [Role.teacher])
    expect(await papeis('c-adm-1')).toEqual(['teacher'])
    // Agora o c-adm-2 é o último.
    await expect(auth.setTenantRoles(doPolo, 'c-adm-2', [Role.student])).rejects.toBeInstanceOf(BadRequestException)
    expect(await papeis('c-adm-2')).toEqual(['admin'])
    // A plataforma age como admin em qualquer polo, então o polo não fica sem quem o administre.
    await auth.setTenantRoles(plataforma, 'c-adm-2', [Role.student])
    expect(await papeis('c-adm-2')).toEqual(['student'])
    // Quem não é do polo é 404 também no serviço.
    await expect(auth.setTenantRoles(doPolo, w.u.adminA, [Role.teacher])).rejects.toThrow('Usuário não encontrado neste polo.')
  })

  it('só o admin do polo do endereço mexe nos usuários', async () => {
    const quem = [como(w.a.host, w.u.adminB), como(w.a.host, w.u.teacherA), como(w.a.host, w.u.studentA)]
    for (const headers of quem) {
      // B5: a negação do RolesGuard sai em português, com code estável (não o "Forbidden resource" do Nest).
      const lista = await app.http().get('/api/admin/users').set(headers)
      expect([lista.status, lista.body]).toEqual([403, { statusCode: 403, code: 'FORBIDDEN', message: 'Você não tem permissão para esta ação neste endereço.' }])
      expect((await app.http().get(`/api/admin/users/${w.u.studentA}`).set(headers)).status).toBe(403)
      expect((await app.http().post('/api/admin/users').set(headers).send({ email: 'intruso@teste.local', displayName: 'Intruso', password: 'segredo123', roles: ['admin'] })).status).toBe(403)
      expect((await app.http().patch(`/api/admin/users/${w.u.studentA}/roles`).set(headers).send({ roles: ['admin'] })).status).toBe(403)
      expect((await app.http().post(`/api/admin/users/${w.u.studentA}/enrollments`).set(headers).send({ courseId: w.courses.aDraft.id })).status).toBe(403)
    }
    expect(app.fakes.identity.emails.has('intruso@teste.local')).toBe(false)
    expect(await vinculoDe(w.a.id, w.u.studentA)).toEqual([{ roles: ['student'] }])
  })

  describe('B4: o vínculo imposto não dá poder sobre a pessoa', () => {
    const MSG_PLATAFORMA = 'Esta conta é da equipe do Studio Pilari e não pode ser alterada pelo polo.'
    const MSG_SENHA = 'Esta pessoa também está ligada a outro polo da rede, e a senha vale em todos eles: quem redefine a senha é o Studio Pilari.'
    const vinculos = (uid: string) => consulta<{ tenant_id: string; roles: string[] }>('SELECT tenant_id, roles FROM tenant_members WHERE user_uid = ? ORDER BY tenant_id', [uid])

    it('o admin do A vincula o admin do B, mas não redefine a senha dele (vale na rede inteira): 403, e nenhum e-mail sai', async () => {
      app.fakes.identity.emails.set('u-adm-b@teste.local', w.u.adminB)
      const vinculo = await app.http().post('/api/admin/users').set(comoAdminA())
        .send({ email: 'u-adm-b@teste.local', displayName: 'Admin B', password: 'segredo123', roles: ['student'] })
      expect(vinculo.status).toBe(201)
      const envios = app.fakes.identity.resetEmails.length
      const revogar = jest.spyOn(app.fakes.identity, 'revokeTokens')
      const r = await app.http().post(`/api/admin/users/${w.u.adminB}/password-reset`).set(comoAdminA())
      expect([r.status, r.body.code, r.body.message]).toEqual([403, 'SHARED_USER_PLATFORM_ONLY', MSG_SENHA])
      expect(app.fakes.identity.resetEmails).toHaveLength(envios)
      expect(revogar).not.toHaveBeenCalled()
      // O polo do admin do B (onde ele é exclusivo) e a plataforma redefinem.
      expect((await app.http().post(`/api/admin/users/${w.u.adminB}/password-reset`).set(como(w.b.host, w.u.platform))).status).toBe(201)
    })

    it('a conta da plataforma não é vinculada pelo e-mail: 403 e nenhuma linha em tenant_members; editar, papéis e senha dela pelo A: 404', async () => {
      app.fakes.identity.emails.set('u-plat@teste.local', w.u.platform)
      app.fakes.identity.emails.set('u-adm-m@teste.local', w.u.adminMatriz)
      for (const email of ['u-plat@teste.local', 'U-Adm-M@teste.local']) {
        const r = await app.http().post('/api/admin/users').set(comoAdminA()).send({ email, displayName: 'Intruso', password: 'segredo123', roles: ['admin'] })
        expect([email, r.status, r.body.code, r.body.message]).toEqual([email, 403, 'PLATFORM_ACCOUNT', MSG_PLATAFORMA])
      }
      expect(await vinculos(w.u.platform)).toEqual([])
      expect(await vinculos(w.u.adminMatriz)).toEqual([{ tenant_id: w.matriz.id, roles: ['admin'] }])
      // Sem vínculo com o A, o resto é 404 (como qualquer pessoa de fora do polo).
      expect((await app.http().patch(`/api/admin/users/${w.u.platform}`).set(comoAdminA()).send({ displayName: 'Nome Do Intruso' })).status).toBe(404)
      expect((await app.http().patch(`/api/admin/users/${w.u.platform}/roles`).set(comoAdminA()).send({ roles: ['student'] })).status).toBe(404)
      expect((await app.http().post(`/api/admin/users/${w.u.platform}/password-reset`).set(comoAdminA())).status).toBe(404)
      // A cortesia criaria o vínculo: é recusada antes.
      const cortesia = await app.http().post(`/api/admin/users/${w.u.platform}/enrollments`).set(comoAdminA()).send({ courseId: w.courses.a.id })
      expect([cortesia.status, cortesia.body.code]).toEqual([403, 'PLATFORM_ACCOUNT'])
      expect(await vinculos(w.u.platform)).toEqual([])
      expect(await consulta('SELECT 1 FROM enrollments WHERE user_id = ?', [w.u.platform])).toEqual([])
    })

    it('conta da plataforma que já é membro do polo: o polo vê, mas não edita, não troca papéis, não redefine senha nem dá ou tira cortesia', async () => {
      // O admin da matriz (admin da plataforma, B10) também dá aula no A, e tem acesso (de cortesia) a um curso do A.
      await seedMember(t, w.a.id, w.u.adminMatriz, ['teacher'])
      await seedEnrollment(t, { userId: w.u.adminMatriz, courseId: w.courses.aDraft.id })
      const detalhe = await app.http().get(`/api/admin/users/${w.u.adminMatriz}`).set(comoAdminA())
      expect([detalhe.status, detalhe.body.user.isPlatformAdmin, detalhe.body.user.roles]).toEqual([200, true, ['teacher']])
      const nome = await app.http().patch(`/api/admin/users/${w.u.adminMatriz}`).set(comoAdminA()).send({ displayName: 'Nome Pelo Polo' })
      const papeis = await app.http().patch(`/api/admin/users/${w.u.adminMatriz}/roles`).set(comoAdminA()).send({ roles: ['student'] })
      const senha = await app.http().post(`/api/admin/users/${w.u.adminMatriz}/password-reset`).set(comoAdminA())
      const cortesia = await app.http().post(`/api/admin/users/${w.u.adminMatriz}/enrollments`).set(comoAdminA()).send({ courseId: w.courses.a.id })
      const retirada = await app.http().delete(`/api/admin/users/${w.u.adminMatriz}/enrollments/${w.courses.aDraft.id}`).set(comoAdminA())
      for (const r of [nome, papeis, senha, cortesia, retirada]) expect([r.status, r.body.code, r.body.message]).toEqual([403, 'PLATFORM_ACCOUNT', MSG_PLATAFORMA])
      expect(await consulta('SELECT status FROM enrollments WHERE user_id = ? AND course_id = ?', [w.u.adminMatriz, w.courses.aDraft.id])).toEqual([{ status: 'active' }])
      expect(await vinculos(w.u.adminMatriz)).toEqual(
        [{ tenant_id: w.matriz.id, roles: ['admin'] }, { tenant_id: w.a.id, roles: ['teacher'] }].sort((x, y) => x.tenant_id.localeCompare(y.tenant_id))
      )
      expect(await consulta('SELECT display_name FROM users WHERE uid = ?', [w.u.adminMatriz])).toEqual([{ display_name: `Usuário ${w.u.adminMatriz}` }])
      // A plataforma troca os papéis dela no A.
      expect((await app.http().patch(`/api/admin/users/${w.u.adminMatriz}/roles`).set(como(w.a.host, w.u.platform)).send({ roles: ['student'] })).status).toBe(200)
      await t.pool.query('DELETE FROM tenant_members WHERE tenant_id = ? AND user_uid = ?', [w.a.id, w.u.adminMatriz])
      await t.pool.query('DELETE FROM enrollments WHERE user_id = ? AND course_id = ?', [w.u.adminMatriz, w.courses.aDraft.id])
    })
  })

  it('B12: polo suspenso não concede cortesia (nem pela plataforma); criar e editar usuário continuam', async () => {
    const polo = await seedTenant(t, { slug: 'polo-suspenso', name: 'Polo Suspenso', status: 'suspended' })
    await seedUser(t, { uid: 's-adm' })
    await seedUser(t, { uid: 's-aluno' })
    await seedMember(t, polo.id, 's-adm', ['admin'])
    await seedMember(t, polo.id, 's-aluno', ['student'])
    const curso = await seedCourse(t, { tenantId: polo.id, slug: 'curso-s', title: 'Curso do Suspenso', instructorId: 's-adm' })
    for (const quem of ['s-adm', w.u.platform]) {
      const r = await app.http().post('/api/admin/users/s-aluno/enrollments').set(como(polo.host, quem)).send({ courseId: curso.id })
      expect([quem, r.status, r.body.code, r.body.message]).toEqual([
        quem, 403, 'TENANT_SUSPENDED', 'O polo está suspenso: novas matrículas ficam bloqueadas até a regularização.',
      ])
    }
    expect(await consulta('SELECT 1 FROM enrollments WHERE user_id = ?', ['s-aluno'])).toEqual([])
    const novo = await app.http().post('/api/admin/users').set(como(polo.host, 's-adm'))
      .send({ email: 'nova.aluna@suspenso.com', displayName: 'Nova Aluna', password: 'segredo123', roles: ['student'] })
    expect(novo.status).toBe(201)
    expect((await app.http().patch('/api/admin/users/s-aluno').set(como(polo.host, 's-adm')).send({ displayName: 'Aluno Corrigido' })).status).toBe(200)
  })
})
