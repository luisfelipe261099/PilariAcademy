import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common'
import { Role } from '@pilari/types'
import { createDrizzleMock, withQueryResults, type DrizzleMock } from '../../__test-utils__/drizzle-mock'
import { allWheres } from '../../__test-utils__/sql'
import { tenantDomains, tenantMembers, tenants as tenantsTable, users } from '../../db/schema'
import { PlatformTenantsService } from './platform-tenants.service'

function montar(opts: { emailExiste?: string | null; resetFalha?: boolean } = {}) {
  const db = createDrizzleMock()
  const tenants = {
    getById: jest.fn().mockResolvedValue({ id: 't-n', slug: 'polo-novo', name: 'Polo Novo', isMatriz: false, branding: { primaryColor: '#0a7d3b' } }),
    create: jest.fn().mockResolvedValue({ id: 't-n', slug: 'polo-novo', name: 'Polo Novo', isMatriz: false }),
    update: jest.fn().mockResolvedValue(undefined),
    listDomains: jest.fn().mockResolvedValue([{ host: 'polo-novo.cursos.studiopilari.com.br', isPrimary: true }]),
    addDomain: jest.fn().mockResolvedValue(undefined),
    removeDomain: jest.fn().mockResolvedValue(undefined),
    invalidateCache: jest.fn(),
    siteUrl: jest.fn((t: { slug: string; isMatriz: boolean }) => (t.isMatriz ? 'https://cursos.studiopilari.com.br' : `https://${t.slug}.cursos.studiopilari.com.br`)),
  }
  const members = { rolesOf: jest.fn().mockResolvedValue(null), setRoles: jest.fn().mockResolvedValue(undefined) }
  const identity = {
    findUidByEmail: jest.fn().mockResolvedValue(opts.emailExiste ?? null),
    createIdentity: jest.fn().mockResolvedValue('uid-novo'),
    sendPasswordResetEmail: opts.resetFalha ? jest.fn().mockRejectedValue(new Error('smtp')) : jest.fn().mockResolvedValue(undefined),
    deleteIdentity: jest.fn().mockResolvedValue(undefined),
    // Conta que já existe, por padrão, já entrou alguma vez.
    hasSignedIn: jest.fn().mockResolvedValue(true),
  }
  const auth = { ensureUserRow: jest.fn().mockResolvedValue({}) }
  const svc = new PlatformTenantsService(db as never, tenants as never, members as never, identity as never, auth as never)
  return { db, svc, tenants, members, identity, auth }
}

/** Silencia e espia o log de erro do serviço: a compensação registra o que não conseguiu desfazer. */
const logDeErro = (svc: PlatformTenantsService) => jest.spyOn((svc as unknown as { logger: Logger }).logger, 'error').mockImplementation(() => undefined)

describe('PlatformTenantsService.addAdmin', () => {
  it('e-mail novo: cria a conta com senha aleatória, vincula como admin e manda o link de senha', async () => {
    const { svc, identity, members, auth } = montar()
    const r = await svc.addAdmin('t-n', ' Diretora@Polo.com.br ', 'Diretora')
    expect(identity.createIdentity).toHaveBeenCalledWith('diretora@polo.com.br', 'Diretora', expect.any(String))
    expect(auth.ensureUserRow).toHaveBeenCalledWith({ uid: 'uid-novo', email: 'diretora@polo.com.br', displayName: 'Diretora' })
    expect(members.setRoles).toHaveBeenCalledWith('t-n', 'uid-novo', [Role.admin])
    expect(identity.sendPasswordResetEmail).toHaveBeenCalledWith('diretora@polo.com.br')
    expect(r).toEqual({ uid: 'uid-novo', email: 'diretora@polo.com.br', existingAccount: false, resetEmailSent: true })
  })

  it('e-mail com conta: só vincula, mantém os papéis que já tinha no polo e não mexe na senha', async () => {
    const { svc, identity, members } = montar({ emailExiste: 'uid-velho' })
    members.rolesOf.mockResolvedValue([Role.teacher])
    const r = await svc.addAdmin('t-n', 'prof@x.com', 'Prof')
    expect(identity.createIdentity).not.toHaveBeenCalled()
    expect(identity.sendPasswordResetEmail).not.toHaveBeenCalled()
    expect(members.setRoles).toHaveBeenCalledWith('t-n', 'uid-velho', [Role.teacher, Role.admin])
    expect(r.existingAccount).toBe(true)
  })

  it('conta que já existia mas nunca entrou (B11): vincula e reenvia o link de definir senha', async () => {
    const { svc, identity, members } = montar({ emailExiste: 'uid-sem-login' })
    identity.hasSignedIn.mockResolvedValue(false)
    const r = await svc.addAdmin('t-n', 'Diretora@Polo.com', 'Diretora')
    expect(identity.hasSignedIn).toHaveBeenCalledWith('uid-sem-login')
    expect(identity.createIdentity).not.toHaveBeenCalled()
    expect(members.setRoles).toHaveBeenCalledWith('t-n', 'uid-sem-login', [Role.admin])
    expect(identity.sendPasswordResetEmail).toHaveBeenCalledWith('diretora@polo.com')
    expect(r).toEqual({ uid: 'uid-sem-login', email: 'diretora@polo.com', existingAccount: true, resetEmailSent: true })
  })

  it('conta que já entrou continua sem link; conta nova nem pergunta (sempre recebe)', async () => {
    const velho = montar({ emailExiste: 'uid-velho' })
    expect((await velho.svc.addAdmin('t-n', 'prof@x.com', 'Prof')).resetEmailSent).toBe(false)
    expect(velho.identity.sendPasswordResetEmail).not.toHaveBeenCalled()
    const novo = montar()
    await novo.svc.addAdmin('t-n', 'a@b.com', 'Ab')
    expect(novo.identity.hasSignedIn).not.toHaveBeenCalled()
    expect(novo.identity.sendPasswordResetEmail).toHaveBeenCalledWith('a@b.com')
  })

  it('não deu para saber se a conta já entrou: vincula, não manda link e registra (sem o e-mail)', async () => {
    const { svc, identity, members } = montar({ emailExiste: 'uid-velho' })
    const aviso = jest.spyOn((svc as unknown as { logger: Logger }).logger, 'warn').mockImplementation(() => undefined)
    identity.hasSignedIn.mockRejectedValue(new Error('firebase fora'))
    const r = await svc.addAdmin('t-n', 'prof@x.com', 'Prof')
    expect(members.setRoles).toHaveBeenCalled()
    expect(r.resetEmailSent).toBe(false)
    expect(identity.sendPasswordResetEmail).not.toHaveBeenCalled()
    expect(String(aviso.mock.calls[0][0])).toContain('uid-velho')
    expect(String(aviso.mock.calls[0][0])).not.toContain('prof@x.com')
  })

  it('falha no envio do link não desfaz o vínculo e é informada', async () => {
    const { svc, members, identity } = montar({ resetFalha: true })
    const r = await svc.addAdmin('t-n', 'a@b.com', 'A')
    expect(members.setRoles).toHaveBeenCalled()
    expect(r.resetEmailSent).toBe(false)
    // A conta e o vínculo ficam: a pessoa pede o link de novo; apagar a conta agora a perderia à toa.
    expect(identity.deleteIdentity).not.toHaveBeenCalled()
  })

  it('a senha aleatória leva minúscula, maiúscula, dígito e símbolo e é diferente a cada conta', async () => {
    const { svc, identity } = montar()
    await svc.addAdmin('t-n', 'a@b.com', 'Ab')
    await svc.addAdmin('t-n', 'c@d.com', 'Cd')
    const senhas = identity.createIdentity.mock.calls.map((c: unknown[]) => c[2] as string)
    expect(senhas).toHaveLength(2)
    for (const senha of senhas) {
      expect(senha.length).toBeGreaterThanOrEqual(32)
      expect(senha).toMatch(/[a-z]/)
      expect(senha).toMatch(/[A-Z]/)
      expect(senha).toMatch(/[0-9]/)
      expect(senha).toMatch(/[^A-Za-z0-9]/)
    }
    expect(senhas[0]).not.toBe(senhas[1])
  })

  it('polo inexistente responde 404', async () => {
    const { svc, tenants } = montar()
    tenants.getById.mockResolvedValue(null)
    await expect(svc.addAdmin('x', 'a@b.com', 'A')).rejects.toThrow('Polo não encontrado.')
  })
})

describe('PlatformTenantsService.list', () => {
  it('soma admins, alunos, publicados e em análise por polo', async () => {
    const { db, svc } = montar()
    withQueryResults(
      db,
      [{ id: 't-a', slug: 'polo-a', name: 'Polo A', status: 'active', isMatriz: false, createdAt: new Date('2026-10-01T00:00:00Z') }],
      [{ tenantId: 't-a', admins: '1', alunos: '2' }],
      [{ tenantId: 't-a', status: 'published', n: 3 }, { tenantId: 't-a', status: 'in_review', n: 1 }, { tenantId: 't-a', status: 'draft', n: 5 }]
    )
    const [a] = await svc.list()
    expect(a).toMatchObject({ id: 't-a', adminCount: 1, studentCount: 2, publishedCourseCount: 3, inReviewCount: 1, siteUrl: 'https://polo-a.cursos.studiopilari.com.br' })
  })
})

describe('PlatformTenantsService.addAdmin: detalhes do vínculo', () => {
  it('quem já é admin do polo continua com um único papel de admin', async () => {
    const { svc, members } = montar({ emailExiste: 'uid-velho' })
    members.rolesOf.mockResolvedValue([Role.admin, Role.teacher])
    await svc.addAdmin('t-n', 'adm@x.com', 'Adm')
    expect(members.setRoles).toHaveBeenCalledWith('t-n', 'uid-velho', [Role.admin, Role.teacher])
  })

  it('apara o nome antes de gravar o cadastro', async () => {
    const { svc, auth } = montar()
    await svc.addAdmin('t-n', 'a@b.com', '  Maria da Silva  ')
    expect(auth.ensureUserRow).toHaveBeenCalledWith({ uid: 'uid-novo', email: 'a@b.com', displayName: 'Maria da Silva' })
  })

  it('polo inexistente: nada é criado nem vinculado', async () => {
    const { svc, tenants, identity, members, auth } = montar()
    tenants.getById.mockResolvedValue(null)
    await expect(svc.addAdmin('x', 'a@b.com', 'A')).rejects.toBeInstanceOf(NotFoundException)
    expect(identity.findUidByEmail).not.toHaveBeenCalled()
    expect(identity.createIdentity).not.toHaveBeenCalled()
    expect(auth.ensureUserRow).not.toHaveBeenCalled()
    expect(members.setRoles).not.toHaveBeenCalled()
  })
})

describe('PlatformTenantsService.create', () => {
  const entrada = { slug: 'polo-novo', name: 'Polo Novo', branding: {}, firstAdminEmail: 'Diretora@Polo.com', firstAdminName: 'Diretora' }
  const linhaDoPolo = { id: 't-n', slug: 'polo-novo', name: 'Polo Novo', status: 'active', isMatriz: false, createdAt: new Date('2026-10-01T00:00:00Z') }

  it('cria o polo, vincula o primeiro admin a ele e devolve o detalhe com marca e domínios', async () => {
    const { db, svc, tenants, members } = montar()
    withQueryResults(db, [linhaDoPolo], [{ tenantId: 't-n', admins: '1', alunos: null }], [])
    const r = await svc.create(entrada)
    expect(tenants.create).toHaveBeenCalledWith({ slug: 'polo-novo', name: 'Polo Novo', branding: {} })
    expect(members.setRoles).toHaveBeenCalledWith('t-n', 'uid-novo', [Role.admin])
    expect(r.firstAdmin).toEqual({ uid: 'uid-novo', email: 'diretora@polo.com', existingAccount: false, resetEmailSent: true })
    expect(r.tenant).toMatchObject({
      id: 't-n', adminCount: 1, studentCount: 0, branding: { primaryColor: '#0a7d3b' }, domains: ['polo-novo.cursos.studiopilari.com.br'],
    })
  })

  it('sem marca no corpo, o polo nasce com marca vazia (o serviço sempre recebe um objeto)', async () => {
    const { db, svc, tenants } = montar()
    withQueryResults(db, [linhaDoPolo], [], [])
    await svc.create({ ...entrada, branding: undefined as never })
    expect(tenants.create).toHaveBeenCalledWith(expect.objectContaining({ branding: {} }))
  })

  it('endereço repetido: o polo não é criado e nenhuma conta é criada nem vinculada', async () => {
    const { svc, tenants, identity, members } = montar()
    tenants.create.mockRejectedValue(new ConflictException('Já existe um polo com este endereço.'))
    await expect(svc.create(entrada)).rejects.toThrow(ConflictException)
    expect(identity.findUidByEmail).not.toHaveBeenCalled()
    expect(identity.createIdentity).not.toHaveBeenCalled()
    expect(members.setRoles).not.toHaveBeenCalled()
  })

  it('e-mail com conta na rede: o primeiro admin é só vinculado', async () => {
    const { db, svc, identity } = montar({ emailExiste: 'uid-velho' })
    withQueryResults(db, [linhaDoPolo], [], [])
    const r = await svc.create(entrada)
    expect(identity.createIdentity).not.toHaveBeenCalled()
    expect(r.firstAdmin).toMatchObject({ uid: 'uid-velho', existingAccount: true, resetEmailSent: false })
  })
})

describe('PlatformTenantsService.list: casos de borda', () => {
  it('polo sem membros nem cursos tem tudo zerado; a matriz usa o endereço da plataforma', async () => {
    const { db, svc } = montar()
    withQueryResults(
      db,
      [
        { id: 'm', slug: 'pilari', name: 'Studio Pilari', status: 'active', isMatriz: true, createdAt: null },
        { id: 't-v', slug: 'vazio', name: 'Vazio', status: 'suspended', isMatriz: false, createdAt: new Date('2026-10-01T00:00:00Z') },
      ],
      [{ tenantId: 'm', admins: null, alunos: '7' }],
      []
    )
    const [matriz, vazio] = await svc.list()
    expect(matriz).toEqual({
      id: 'm', slug: 'pilari', name: 'Studio Pilari', status: 'active', isMatriz: true, siteUrl: 'https://cursos.studiopilari.com.br',
      adminCount: 0, studentCount: 7, publishedCourseCount: 0, inReviewCount: 0, createdAt: null,
    })
    expect(vazio).toMatchObject({ status: 'suspended', adminCount: 0, studentCount: 0, publishedCourseCount: 0, inReviewCount: 0, createdAt: '2026-10-01T00:00:00.000Z' })
  })

  it('cursos de um polo não entram na conta de outro', async () => {
    const { db, svc } = montar()
    withQueryResults(
      db,
      [
        { id: 't-a', slug: 'polo-a', name: 'Polo A', status: 'active', isMatriz: false, createdAt: null },
        { id: 't-b', slug: 'polo-b', name: 'Polo B', status: 'active', isMatriz: false, createdAt: null },
      ],
      [],
      [{ tenantId: 't-b', status: 'published', n: 4 }]
    )
    const [a, b] = await svc.list()
    expect(a.publishedCourseCount).toBe(0)
    expect(b.publishedCourseCount).toBe(4)
  })
})

describe('PlatformTenantsService: detalhe e domínios', () => {
  const linhaDoPolo = { id: 't-n', slug: 'polo-novo', name: 'Polo Novo', status: 'active', isMatriz: false, createdAt: null }

  it('detalhe de polo inexistente responde 404 com code TENANT_NOT_FOUND (B9)', async () => {
    const { svc, tenants } = montar()
    tenants.getById.mockResolvedValue(null)
    await expect(svc.detail('x')).rejects.toMatchObject({ response: { statusCode: 404, code: 'TENANT_NOT_FOUND', message: 'Polo não encontrado.' } })
    for (const chamada of [() => svc.assertExists('x'), () => svc.addAdmin('x', 'a@b.com', 'Ab'), () => svc.addDomain('x', 'a.com.br'), () => svc.removeDomain('x', 'a.com.br')]) {
      await expect(chamada()).rejects.toMatchObject({ response: { code: 'TENANT_NOT_FOUND' } })
    }
  })

  it('PATCH sem nada para alterar → 400 "Nada para alterar.", sem tocar no polo (B9)', async () => {
    const { svc, tenants } = montar()
    const pedido = svc.update('t-n', {})
    await expect(pedido).rejects.toBeInstanceOf(BadRequestException)
    await expect(pedido).rejects.toThrow('Nada para alterar.')
    expect(tenants.update).not.toHaveBeenCalled()
  })

  it('addDomain e removeDomain de polo inexistente respondem 404 sem tocar nos domínios', async () => {
    const { svc, tenants } = montar()
    tenants.getById.mockResolvedValue(null)
    await expect(svc.addDomain('x', 'cursos.polo.com.br')).rejects.toBeInstanceOf(NotFoundException)
    await expect(svc.removeDomain('x', 'cursos.polo.com.br')).rejects.toBeInstanceOf(NotFoundException)
    expect(tenants.addDomain).not.toHaveBeenCalled()
    expect(tenants.removeDomain).not.toHaveBeenCalled()
  })

  it('addDomain, removeDomain e update devolvem o detalhe atualizado', async () => {
    const { db, svc, tenants } = montar()
    withQueryResults(db, [linhaDoPolo], [], [], [linhaDoPolo], [], [], [linhaDoPolo], [], [])
    tenants.listDomains
      .mockResolvedValueOnce([{ host: 'cursos.polo.com.br', isPrimary: false }, { host: 'polo-novo.cursos.studiopilari.com.br', isPrimary: true }])
      .mockResolvedValueOnce([{ host: 'polo-novo.cursos.studiopilari.com.br', isPrimary: true }])
    const add = await svc.addDomain('t-n', 'cursos.polo.com.br')
    expect(tenants.addDomain).toHaveBeenCalledWith('t-n', 'cursos.polo.com.br')
    expect(add.domains).toEqual(['cursos.polo.com.br', 'polo-novo.cursos.studiopilari.com.br'])
    const rem = await svc.removeDomain('t-n', 'cursos.polo.com.br')
    expect(tenants.removeDomain).toHaveBeenCalledWith('t-n', 'cursos.polo.com.br')
    expect(rem.domains).toEqual(['polo-novo.cursos.studiopilari.com.br'])
    const upd = await svc.update('t-n', { name: 'Polo Novo 2', status: 'suspended' })
    expect(tenants.update).toHaveBeenCalledWith('t-n', { name: 'Polo Novo 2', status: 'suspended' })
    expect(upd.id).toBe('t-n')
  })
})

describe('PlatformTenantsService.create: o polo não fica sem admin', () => {
  const entrada = { slug: 'polo-novo', name: 'Polo Novo', branding: {}, firstAdminEmail: 'Diretora@Polo.com', firstAdminName: 'Diretora' }
  const linhaDoPolo = { id: 't-n', slug: 'polo-novo', name: 'Polo Novo', status: 'active', isMatriz: false, createdAt: null }

  /** A transação ganha um handle à parte: o que rodar nele rodou DENTRO da transação, o que rodar em `db` rodou fora. */
  function comTransacao(db: DrizzleMock): DrizzleMock {
    const tx = createDrizzleMock()
    db.transaction.mockImplementation((cb: (t: unknown) => unknown) => cb(tx))
    return tx
  }
  const tabelas = (m: DrizzleMock) => m.delete.mock.calls.map((c: unknown[]) => c[0])

  it('a conta nem chegou a ser criada: remove membros, domínios e polo numa transação, limpa o cache e relança o erro original', async () => {
    const { db, svc, tenants, identity, members } = montar()
    const tx = comTransacao(db)
    const original = Object.assign(new Error('Firebase fora do ar'), { code: 'auth/internal-error' })
    identity.createIdentity.mockRejectedValue(original)

    const erro = await svc.create(entrada).catch((e: unknown) => e)

    expect(erro).toBe(original)
    expect(tenants.create).toHaveBeenCalledTimes(1)
    expect(db.transaction).toHaveBeenCalledTimes(1)
    expect(tabelas(tx)).toEqual([tenantMembers, tenantDomains, tenantsTable])
    expect(tx.delete).toHaveBeenCalledTimes(3)
    expect(db.delete).not.toHaveBeenCalled()
    const [dosMembros, dosDominios, doPolo] = allWheres(tx.where)
    expect(dosMembros).toEqual({ sql: expect.stringContaining('`tenant_members`.`tenant_id` = ?'), params: ['t-n'] })
    expect(dosDominios).toEqual({ sql: expect.stringContaining('`tenant_domains`.`tenant_id` = ?'), params: ['t-n'] })
    expect(doPolo).toEqual({ sql: expect.stringContaining('`tenants`.`id` = ?'), params: ['t-n'] })
    expect(tenants.invalidateCache).toHaveBeenCalledTimes(1)
    expect(identity.deleteIdentity).not.toHaveBeenCalled()
    expect(members.setRoles).not.toHaveBeenCalled()
    expect(identity.sendPasswordResetEmail).not.toHaveBeenCalled()
  })

  it('a conta já foi criada e o vínculo falha: apaga a conta nova e o cadastro dela, remove o polo e relança o erro original', async () => {
    const { db, svc, tenants, identity, members, auth } = montar()
    const tx = comTransacao(db)
    const original = new Error('banco caiu')
    members.setRoles.mockRejectedValue(original)

    const erro = await svc.create(entrada).catch((e: unknown) => e)

    expect(erro).toBe(original)
    expect(identity.createIdentity).toHaveBeenCalledTimes(1)
    expect(auth.ensureUserRow).toHaveBeenCalledTimes(1)
    expect(identity.deleteIdentity).toHaveBeenCalledWith('uid-novo')
    // Os vínculos e o cadastro espelhado da conta nova saem junto (fora da transação do polo): sem isso sobraria um admin
    // fantasma (que conta no anti-lockout) e um usuário fantasma. A conta é nova, então todo vínculo dela é desta chamada.
    expect(tabelas(db)).toEqual([tenantMembers, users])
    expect(allWheres(db.where).slice(0, 2)).toEqual([
      { sql: expect.stringContaining('`tenant_members`.`user_uid` = ?'), params: ['uid-novo'] },
      { sql: expect.stringContaining('`users`.`uid` = ?'), params: ['uid-novo'] },
    ])
    expect(tabelas(tx)).toEqual([tenantMembers, tenantDomains, tenantsTable])
    expect(tenants.invalidateCache).toHaveBeenCalledTimes(1)
    // Ninguém recebe link de senha de uma conta que deixou de existir.
    expect(identity.sendPasswordResetEmail).not.toHaveBeenCalled()
  })

  it('o ensureUserRow falha logo depois de a conta ser criada: a conta é apagada do mesmo jeito', async () => {
    const { db, svc, identity, auth } = montar()
    const tx = comTransacao(db)
    auth.ensureUserRow.mockRejectedValue(new Error('banco caiu'))
    await expect(svc.create(entrada)).rejects.toThrow('banco caiu')
    expect(identity.deleteIdentity).toHaveBeenCalledWith('uid-novo')
    expect(tx.delete).toHaveBeenCalledTimes(3)
  })

  it('conta que já existia na rede: o polo some, mas a conta e o cadastro dela ficam como estavam', async () => {
    const { db, svc, identity, members } = montar({ emailExiste: 'uid-velho' })
    const tx = comTransacao(db)
    members.setRoles.mockRejectedValue(new Error('banco caiu'))

    await expect(svc.create(entrada)).rejects.toThrow('banco caiu')

    expect(identity.createIdentity).not.toHaveBeenCalled()
    expect(identity.deleteIdentity).not.toHaveBeenCalled()
    expect(db.delete).not.toHaveBeenCalled()
    expect(tabelas(tx)).toEqual([tenantMembers, tenantDomains, tenantsTable])
  })

  it('o erro original sobe com o mesmo status: o do Firebase (409 e-mail repetido) não vira 500 na volta', async () => {
    const { db, svc, identity } = montar()
    comTransacao(db)
    const original = new ConflictException('Já existe um usuário com este e-mail.')
    identity.createIdentity.mockRejectedValue(original)
    const erro = await svc.create(entrada).catch((e: unknown) => e)
    expect(erro).toBe(original)
    expect((erro as ConflictException).getStatus()).toBe(409)
  })

  it('falha na própria compensação é registrada no log e não esconde o erro original', async () => {
    const { db, svc, tenants, identity, members } = montar()
    const registro = logDeErro(svc)
    const original = new Error('banco caiu')
    members.setRoles.mockRejectedValue(original)
    identity.deleteIdentity.mockRejectedValue(new Error('firebase fora'))
    db.transaction.mockRejectedValue(new Error('transação perdida'))

    const erro = await svc.create(entrada).catch((e: unknown) => e)

    expect(erro).toBe(original)
    // As etapas são independentes: a falha de uma não pula as outras.
    expect(identity.deleteIdentity).toHaveBeenCalledWith('uid-novo')
    expect(db.delete).toHaveBeenCalledTimes(2)
    expect(db.transaction).toHaveBeenCalledTimes(1)
    expect(tenants.invalidateCache).toHaveBeenCalledTimes(1)
    // Cada falha fica no log com o identificador para o suporte limpar à mão, e sem o e-mail (PII).
    const textos = registro.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(textos).toHaveLength(2)
    expect(textos.some((t) => t.includes('uid-novo') && t.includes('firebase fora'))).toBe(true)
    expect(textos.some((t) => t.includes('t-n') && t.includes('polo-novo') && t.includes('transação perdida'))).toBe(true)
    expect(textos.join(' ').toLowerCase()).not.toContain('diretora@polo.com')
  })

  it('o cadastro espelhado que não saiu também é registrado e a remoção do polo segue', async () => {
    const { db, svc, members } = montar()
    const tx = comTransacao(db)
    const registro = logDeErro(svc)
    members.setRoles.mockRejectedValue(new Error('banco caiu'))
    // A 1a remoção fora da transação é a dos vínculos da conta nova; a 2a, a do cadastro.
    db.delete.mockImplementationOnce(() => db.delete.getMockImplementation()?.() as never).mockImplementationOnce(() => {
      throw new Error('users travada')
    })
    await expect(svc.create(entrada)).rejects.toThrow('banco caiu')
    expect(tx.delete).toHaveBeenCalledTimes(3)
    expect(registro).toHaveBeenCalledTimes(1)
    expect(String(registro.mock.calls[0][0])).toContain('users travada')
  })

  it('os vínculos da conta nova que não saíram também são registrados, e o cadastro sai do mesmo jeito', async () => {
    const { db, svc, members } = montar()
    comTransacao(db)
    const registro = logDeErro(svc)
    members.setRoles.mockRejectedValue(new Error('banco caiu'))
    db.delete.mockImplementationOnce(() => {
      throw new Error('vínculos travados')
    })
    await expect(svc.create(entrada)).rejects.toThrow('banco caiu')
    expect(db.delete.mock.calls.map((c: unknown[]) => c[0])).toEqual([tenantMembers, users])
    expect(registro).toHaveBeenCalledTimes(1)
    expect(String(registro.mock.calls[0][0])).toContain('vínculos travados')
    expect(String(registro.mock.calls[0][0])).toContain('uid-novo')
  })

  it('tudo certo: nada é desfeito', async () => {
    const { db, svc, tenants, identity } = montar()
    withQueryResults(db, [linhaDoPolo], [], [])
    await svc.create(entrada)
    expect(db.transaction).not.toHaveBeenCalled()
    expect(db.delete).not.toHaveBeenCalled()
    expect(identity.deleteIdentity).not.toHaveBeenCalled()
    expect(tenants.invalidateCache).not.toHaveBeenCalled()
  })

  it('falha só na leitura final do detalhe não desfaz nada: polo e admin já estão completos e o link de senha já saiu', async () => {
    const { db, svc, tenants, identity } = montar()
    tenants.getById.mockResolvedValueOnce({ id: 't-n', slug: 'polo-novo', name: 'Polo Novo', isMatriz: false, branding: {} }).mockResolvedValue(null)
    await expect(svc.create(entrada)).rejects.toThrow('Polo não encontrado.')
    expect(identity.sendPasswordResetEmail).toHaveBeenCalledTimes(1)
    expect(db.transaction).not.toHaveBeenCalled()
    expect(identity.deleteIdentity).not.toHaveBeenCalled()
  })
})

describe('PlatformTenantsService.addAdmin: conta criada e vínculo que falha', () => {
  it('apaga a conta criada nesta chamada e o cadastro dela, para a nova tentativa recomeçar do zero e mandar o link de senha', async () => {
    const { db, svc, identity, auth } = montar()
    const original = new Error('banco caiu')
    auth.ensureUserRow.mockRejectedValue(original)

    const erro = await svc.addAdmin('t-n', 'a@b.com', 'Ab').catch((e: unknown) => e)

    expect(erro).toBe(original)
    expect(identity.deleteIdentity).toHaveBeenCalledWith('uid-novo')
    expect(db.delete.mock.calls.map((c: unknown[]) => c[0])).toEqual([tenantMembers, users])
    expect(allWheres(db.where).map((w) => w.params)).toEqual([['uid-novo'], ['uid-novo']])
    // Quem só vincula admin não mexe no polo: apagar o polo é coisa da criação.
    expect(db.transaction).not.toHaveBeenCalled()
    expect(identity.sendPasswordResetEmail).not.toHaveBeenCalled()
  })

  it('o setRoles falha depois de a conta ser criada: mesma limpeza, vínculos inclusive (o vínculo pode ter sido gravado)', async () => {
    const { db, svc, identity, members } = montar()
    members.setRoles.mockRejectedValue(new Error('banco caiu'))
    await expect(svc.addAdmin('t-n', 'a@b.com', 'Ab')).rejects.toThrow('banco caiu')
    expect(identity.deleteIdentity).toHaveBeenCalledWith('uid-novo')
    expect(db.delete.mock.calls.map((c: unknown[]) => c[0])).toEqual([tenantMembers, users])
  })

  it('conta que já existia nunca é apagada, nem o cadastro dela', async () => {
    const { db, svc, identity, members } = montar({ emailExiste: 'uid-velho' })
    members.setRoles.mockRejectedValue(new Error('banco caiu'))
    await expect(svc.addAdmin('t-n', 'prof@x.com', 'Prof')).rejects.toThrow('banco caiu')
    expect(identity.deleteIdentity).not.toHaveBeenCalled()
    expect(db.delete).not.toHaveBeenCalled()
  })

  it('o createIdentity falha: não há conta para apagar', async () => {
    const { db, svc, identity } = montar()
    identity.createIdentity.mockRejectedValue(new ConflictException('Já existe um usuário com este e-mail.'))
    await expect(svc.addAdmin('t-n', 'a@b.com', 'Ab')).rejects.toThrow(ConflictException)
    expect(identity.deleteIdentity).not.toHaveBeenCalled()
    expect(db.delete).not.toHaveBeenCalled()
  })

  it('o erro original sobe mesmo quando a limpeza da conta falha, e a falha vai para o log', async () => {
    const { svc, identity, members } = montar()
    const registro = logDeErro(svc)
    const original = new Error('banco caiu')
    members.setRoles.mockRejectedValue(original)
    identity.deleteIdentity.mockRejectedValue(new Error('firebase fora'))
    const erro = await svc.addAdmin('t-n', 'a@b.com', 'Ab').catch((e: unknown) => e)
    expect(erro).toBe(original)
    expect(registro).toHaveBeenCalledTimes(1)
    expect(String(registro.mock.calls[0][0])).toContain('uid-novo')
    expect(String(registro.mock.calls[0][0])).not.toContain('a@b.com')
  })
})
