import { bootTestApp, type TestApp } from './helpers/app'
import { createTestDatabase, type TestDatabase } from './helpers/db'
import { bearer, seedMember, seedTwoPolos, seedUser, type TwoPolos } from './helpers/seed'
import { eventually } from './helpers/wait'

describe('papéis por polo', () => {
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

  const me = (host: string, uid: string) => app.http().get('/api/auth/me').set('Host', host).set('Authorization', bearer(uid))

  it('admin do polo A é admin no A e não tem papel no B', async () => {
    expect((await me(w.a.host, w.u.adminA)).body.roles).toEqual(['admin'])
    expect((await me(w.b.host, w.u.adminA)).body.roles).toEqual([])
  })

  it('admin da plataforma é admin em qualquer polo', async () => {
    const r = await me(w.b.host, w.u.platform)
    expect(r.body.roles).toEqual(['admin'])
    expect(r.body.user.isPlatformAdmin).toBe(true)
  })

  it('o login num polo novo cria o vínculo de aluno', async () => {
    const sync = await app.http().post('/api/auth/sync-user-data').set('Host', w.b.host).set('Authorization', bearer(w.u.studentA)).send({})
    expect(sync.status).toBe(201)
    expect(sync.body.roles).toEqual(['student'])
    const [rows] = await t.pool.query('SELECT roles FROM tenant_members WHERE tenant_id = ? AND user_uid = ?', [w.b.id, w.u.studentA])
    expect(rows).toEqual([{ roles: ['student'] }])
  })

  it('o login da plataforma num polo não cria vínculo', async () => {
    await app.http().post('/api/auth/sync-user-data').set('Host', w.a.host).set('Authorization', bearer(w.u.platform)).send({})
    const [rows] = await t.pool.query('SELECT 1 FROM tenant_members WHERE tenant_id = ? AND user_uid = ?', [w.a.id, w.u.platform])
    expect(rows).toEqual([])
  })

  it('rota de admin no polo errado responde 403', async () => {
    const r = await app.http().get('/api/admin/stats').set('Host', w.b.host).set('Authorization', bearer(w.u.adminA))
    expect(r.status).toBe(403)
  })

  describe('B1: o login não desfaz a correção de nome', () => {
    const sync = (host: string, uid: string, body: object = {}) =>
      app.http().post('/api/auth/sync-user-data').set('Host', host).set('Authorization', bearer(uid)).send(body)
    const cadastro = async (uid: string) =>
      (await t.pool.query('SELECT display_name, photo_url FROM users WHERE uid = ?', [uid]))[0] as Array<{ display_name: string | null; photo_url: string | null }>

    it('o nome corrigido pela plataforma sobrevive ao login, com nome no corpo ou do Firebase; a foto vazia é preenchida uma vez', async () => {
      const corrigido = await app.http().patch(`/api/admin/users/${w.u.shared}`).set('Host', w.a.host).set('Authorization', bearer(w.u.platform))
        .send({ displayName: 'Nome Corrigido Pelo Studio Pilari' })
      expect(corrigido.status).toBe(200)
      // Corpo com outro nome e uma foto: o nome fica; a foto, que estava vazia, entra.
      const r = await sync(w.a.host, w.u.shared, { displayName: 'Nome Do Google', photoUrl: 'https://fotos.exemplo/1.png' })
      expect([r.status, r.body.user.displayName]).toEqual([201, 'Nome Corrigido Pelo Studio Pilari'])
      expect(await cadastro(w.u.shared)).toEqual([{ display_name: 'Nome Corrigido Pelo Studio Pilari', photo_url: 'https://fotos.exemplo/1.png' }])
      // Sem corpo, o nome do Firebase ("Usuário <uid>") também não passa por cima; nem uma foto nova.
      await sync(w.b.host, w.u.shared, { photoUrl: 'https://fotos.exemplo/2.png' })
      await sync(w.a.host, w.u.shared)
      expect(await cadastro(w.u.shared)).toEqual([{ display_name: 'Nome Corrigido Pelo Studio Pilari', photo_url: 'https://fotos.exemplo/1.png' }])
    })

    it('o nome corrigido pelo admin do polo, em aluno só dele, também sobrevive ao login', async () => {
      const corrigido = await app.http().patch(`/api/admin/users/${w.u.studentA}`).set('Host', w.a.host).set('Authorization', bearer(w.u.adminA))
        .send({ displayName: 'Aluna Do Polo A Corrigida' })
      expect(corrigido.status).toBe(200)
      await sync(w.a.host, w.u.studentA, { displayName: 'apelido' })
      expect((await cadastro(w.u.studentA))[0].display_name).toBe('Aluna Do Polo A Corrigida')
    })

    it('o primeiro login preenche o nome (do corpo ou do Firebase); cadastro com nome vazio também é preenchido', async () => {
      const primeiro = await sync(w.a.host, 'u-primeiro-login')
      expect([primeiro.status, primeiro.body.user.displayName]).toEqual([201, 'Usuário u-primeiro-login'])
      expect(await cadastro('u-primeiro-login')).toEqual([{ display_name: 'Usuário u-primeiro-login', photo_url: null }])
      await seedUser(t, { uid: 'u-nome-vazio', name: '' })
      await sync(w.a.host, 'u-nome-vazio', { displayName: 'Nome Que Faltava' })
      expect((await cadastro('u-nome-vazio'))[0].display_name).toBe('Nome Que Faltava')
    })

    it('corrida: a correção do nome (e a desativação) gravada enquanto o login sincroniza não é desfeita', async () => {
      await seedUser(t, { uid: 'u-corrida-sync', name: 'Nome Errado' })
      const outra = await t.pool.getConnection()
      try {
        // A correção pela plataforma segura a linha do cadastro enquanto o login sincroniza.
        await outra.query('START TRANSACTION')
        await outra.query('SELECT uid FROM users WHERE uid = ? FOR UPDATE', ['u-corrida-sync'])
        const resposta = sync(w.a.host, 'u-corrida-sync', { displayName: 'Nome Do Google' }).then((r) => r)
        await eventually(
          async () => Number(((await t.pool.query("SELECT COUNT(*) AS n FROM information_schema.innodb_trx WHERE trx_state = 'LOCK WAIT'"))[0] as Array<{ n: number }>)[0].n),
          (n) => n > 0,
          10_000 // em máquina carregada a requisição pode demorar a chegar na trava
        )
        await outra.query("UPDATE users SET display_name = 'Nome Certo', disabled = 1 WHERE uid = ?", ['u-corrida-sync'])
        await outra.query('COMMIT')
        expect((await resposta).status).toBe(201)
        const [rows] = await t.pool.query('SELECT display_name, disabled FROM users WHERE uid = ?', ['u-corrida-sync'])
        expect(rows).toEqual([{ display_name: 'Nome Certo', disabled: 1 }])
      } finally {
        outra.release()
      }
    })
  })

  describe('B8: o próprio perfil da pessoa compartilhada', () => {
    const perfil = (host: string, uid: string, body: object) =>
      app.http().patch('/api/auth/profile').set('Host', host).set('Authorization', bearer(uid)).send(body)
    const MSG = 'Seu nome e CPF vão para certificados de mais de um polo. Para corrigir, fale com o Studio Pilari.'
    const cadastro = async (uid: string) =>
      ((await t.pool.query('SELECT display_name, cpf, bio FROM users WHERE uid = ?', [uid]))[0] as Array<Record<string, string | null>>)[0]

    it('não troca o nome já preenchido, em nenhum dos polos dela, e nada é gravado', async () => {
      const antes = await cadastro(w.u.shared)
      for (const host of [w.a.host, w.b.host]) {
        const r = await perfil(host, w.u.shared, { displayName: 'Nome Que Ela Quer' })
        expect([r.status, r.body.code, r.body.message]).toEqual([403, 'SHARED_USER_PLATFORM_ONLY', MSG])
      }
      expect(await cadastro(w.u.shared)).toEqual(antes)
    })

    it('preenche o CPF vazio; trocar o CPF já gravado é recusado', async () => {
      const preenche = await perfil(w.a.host, w.u.shared, { cpf: '529.982.247-25' })
      expect([preenche.status, preenche.body.cpf, preenche.body.cpfLocked]).toEqual([200, '52998224725', true])
      const troca = await perfil(w.a.host, w.u.shared, { cpf: '111.444.777-35' })
      expect([troca.status, troca.body.code]).toEqual([403, 'SHARED_USER_PLATFORM_ONLY'])
      expect((await cadastro(w.u.shared)).cpf).toBe('52998224725')
    })

    it('a tela do instrutor manda o nome junto com a bio: reenviar o mesmo nome não é troca', async () => {
      const atual = (await cadastro(w.u.shared)).display_name as string
      const r = await perfil(w.a.host, w.u.shared, { displayName: atual, bio: 'Bio nova', photoUrl: '', headline: '' })
      expect(r.status).toBe(200)
      expect(await cadastro(w.u.shared)).toMatchObject({ display_name: atual, bio: 'Bio nova' })
    })

    it('a pessoa exclusiva do polo continua trocando o próprio nome', async () => {
      // O aluno do A visitou o site do B (o login criou o vínculo de aluno lá): continua exclusivo do A.
      const r = await perfil(w.a.host, w.u.studentA, { displayName: 'Nome Novo Da Aluna' })
      expect([r.status, r.body.displayName]).toEqual([200, 'Nome Novo Da Aluna'])
    })

    it('o endereço não decide: a aluna só do A troca o nome também pelo site da matriz ou do B; a compartilhada não troca por nenhum', async () => {
      for (const [host, nome] of [[w.matriz.host, 'Nome Pela Matriz'], [w.b.host, 'Nome Pelo Polo B']] as const) {
        const r = await perfil(host, w.u.studentA, { displayName: nome })
        expect([host, r.status, r.body.displayName]).toEqual([host, 200, nome])
      }
      const pelaMatriz = await perfil(w.matriz.host, w.u.shared, { displayName: 'Outro Nome Qualquer' })
      expect([pelaMatriz.status, pelaMatriz.body.code]).toEqual([403, 'SHARED_USER_PLATFORM_ONLY'])
    })
  })

  describe('B10: o admin da matriz é admin da plataforma, e a tela da matriz dá e tira esse poder', () => {
    const consulta = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => (await t.pool.query(sql, params))[0] as T[]
    const abreConsole = (host: string, uid: string) => app.http().get('/api/platform/tenants').set('Host', host).set('Authorization', bearer(uid))
    const papeisNaMatriz = (alvo: string, roles: string[], quem: string) =>
      app.http().patch(`/api/admin/users/${alvo}/roles`).set('Host', w.matriz.host).set('Authorization', bearer(quem)).send({ roles })
    const vinculoNaMatriz = async (uid: string) =>
      (await consulta<{ roles: string[] }>('SELECT roles FROM tenant_members WHERE tenant_id = ? AND user_uid = ?', [w.matriz.id, uid]))[0]?.roles

    it('o admin da matriz abre rota da plataforma, no endereço da matriz e no de um polo, e é admin em qualquer polo', async () => {
      expect((await abreConsole(w.matriz.host, w.u.adminMatriz)).status).toBe(200)
      // No endereço do polo A o guard lê, na mesma consulta, o vínculo do A e o da matriz.
      expect((await abreConsole(w.a.host, w.u.adminMatriz)).status).toBe(200)
      const r = await me(w.b.host, w.u.adminMatriz)
      expect([r.body.roles, r.body.user.isPlatformAdmin]).toEqual([['admin'], true])
      // O sinal no cadastro continua zerado: o poder vem do vínculo da matriz.
      expect(await consulta('SELECT is_platform_admin FROM users WHERE uid = ?', [w.u.adminMatriz])).toEqual([{ is_platform_admin: 0 }])
      // A lista de usuários da matriz mostra o isPlatformAdmin efetivo.
      const lista = await app.http().get('/api/admin/users').set('Host', w.matriz.host).set('Authorization', bearer(w.u.adminMatriz))
      expect((lista.body.users as Array<{ uid: string; isPlatformAdmin: boolean }>).map((u) => [u.uid, u.isPlatformAdmin])).toEqual([[w.u.adminMatriz, true]])
    })

    it('o login do admin da matriz num polo não cria vínculo de aluno, como o da plataforma', async () => {
      const sync = await app.http().post('/api/auth/sync-user-data').set('Host', w.a.host).set('Authorization', bearer(w.u.adminMatriz)).send({})
      expect(sync.status).toBe(201)
      expect([sync.body.roles, sync.body.user.isPlatformAdmin]).toEqual([['admin'], true])
      expect(await consulta('SELECT 1 FROM tenant_members WHERE tenant_id = ? AND user_uid = ?', [w.a.id, w.u.adminMatriz])).toEqual([])
    })

    it('dar admin na matriz dá o acesso; tirar o admin na matriz tira; o último admin da matriz não sai, nem pela plataforma (409)', async () => {
      await seedUser(t, { uid: 'u-matriz-2' })
      await seedMember(t, w.matriz.id, 'u-matriz-2', ['student'])
      expect((await abreConsole(w.matriz.host, 'u-matriz-2')).status).toBe(403)

      const promovida = await papeisNaMatriz('u-matriz-2', ['admin'], w.u.adminMatriz)
      expect([promovida.status, promovida.body.user.isPlatformAdmin]).toEqual([200, true])
      expect((await abreConsole(w.matriz.host, 'u-matriz-2')).status).toBe(200)
      expect((await me(w.b.host, 'u-matriz-2')).body.roles).toEqual(['admin'])

      const rebaixado = await papeisNaMatriz(w.u.adminMatriz, ['teacher'], 'u-matriz-2')
      expect([rebaixado.status, rebaixado.body.user.isPlatformAdmin]).toEqual([200, false])
      expect((await abreConsole(w.matriz.host, w.u.adminMatriz)).status).toBe(403)
      expect((await abreConsole(w.a.host, w.u.adminMatriz)).status).toBe(403)
      expect((await me(w.b.host, w.u.adminMatriz)).body.roles).toEqual([])

      // u-matriz-2 é agora o único admin da matriz: nem a plataforma o tira (a matriz não fica sem admin pela tela).
      const ultimo = await papeisNaMatriz('u-matriz-2', ['student'], w.u.platform)
      expect([ultimo.status, ultimo.body.code]).toEqual([409, 'LAST_ADMIN'])
      expect(await vinculoNaMatriz('u-matriz-2')).toEqual(['admin'])
      expect((await abreConsole(w.matriz.host, 'u-matriz-2')).status).toBe(200)

      // Volta ao mundo do seed.
      expect((await papeisNaMatriz(w.u.adminMatriz, ['admin'], w.u.platform)).status).toBe(200)
      expect((await papeisNaMatriz('u-matriz-2', ['student'], w.u.adminMatriz)).status).toBe(200)
      expect(await vinculoNaMatriz(w.u.adminMatriz)).toEqual(['admin'])
    })

    it('corrida: dois admins da matriz tirando o admin um do outro ao mesmo tempo não deixam a matriz sem admin (409 para o segundo)', async () => {
      await seedUser(t, { uid: 'u-matriz-3' })
      await seedMember(t, w.matriz.id, 'u-matriz-3', ['admin']) // dois admins: u-adm-m e u-matriz-3
      const adminsDaMatriz = async () =>
        (await consulta<{ user_uid: string }>(`SELECT user_uid FROM tenant_members WHERE tenant_id = ? AND JSON_CONTAINS(roles, '"admin"')`, [w.matriz.id])).map((r) => r.user_uid)
      const outra = await t.pool.getConnection()
      try {
        // A outra troca (u-matriz-3 tirando o admin de u-adm-m) segura os vínculos da matriz enquanto esta começa.
        await outra.query('START TRANSACTION')
        await outra.query('SELECT user_uid FROM tenant_members WHERE tenant_id = ? FOR UPDATE', [w.matriz.id])
        const resposta = papeisNaMatriz('u-matriz-3', ['student'], w.u.adminMatriz).then((r) => r)
        await eventually(
          async () => Number((await consulta<{ n: number }>("SELECT COUNT(*) AS n FROM information_schema.innodb_trx WHERE trx_state = 'LOCK WAIT'"))[0].n),
          (n) => n > 0,
          10_000 // em máquina carregada a requisição pode demorar a chegar na trava
        )
        await outra.query(`UPDATE tenant_members SET roles = '["student"]' WHERE tenant_id = ? AND user_uid = ?`, [w.matriz.id, w.u.adminMatriz])
        await outra.query('COMMIT')
        const r = await resposta
        expect([r.status, r.body.code]).toEqual([409, 'LAST_ADMIN'])
        expect(await adminsDaMatriz()).toEqual(['u-matriz-3'])
      } finally {
        outra.release()
      }
      // Volta ao mundo do seed.
      await t.pool.query(`UPDATE tenant_members SET roles = '["admin"]' WHERE tenant_id = ? AND user_uid = ?`, [w.matriz.id, w.u.adminMatriz])
      await t.pool.query('DELETE FROM tenant_members WHERE tenant_id = ? AND user_uid = ?', [w.matriz.id, 'u-matriz-3'])
      expect(await adminsDaMatriz()).toEqual([w.u.adminMatriz])
    })
  })
})
