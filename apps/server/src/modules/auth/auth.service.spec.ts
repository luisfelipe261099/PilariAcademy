/// <reference types="jest" />
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { Role } from '@pilari/types'
import type { Actor } from '../../common/types/actor.type'
import { TenantMembersService } from '../tenancy/tenant-members.service'
import { MATRIZ_TENANT_ID } from '../tenancy/tenancy.constants'
import { AuthService } from './auth.service'
import {
  createDrizzleMock,
  withQueryResults,
  type DrizzleMock,
} from '../../__test-utils__/drizzle-mock'
import { allWheres, renderSql } from '../../__test-utils__/sql'

const adminDoPolo: Actor = { uid: 'adm', tenantId: 't-a', isMatriz: false, isAdmin: true, isPlatformAdmin: false }
const plataforma: Actor = { ...adminDoPolo, uid: 'plat', isPlatformAdmin: true }
/** Quem age pela tela da matriz: o admin dela é da plataforma (B10). */
const plataformaNaMatriz: Actor = { uid: 'plat', tenantId: MATRIZ_TENANT_ID, isMatriz: true, isAdmin: true, isPlatformAdmin: true }

describe('AuthService', () => {
  let db: DrizzleMock
  let service: AuthService

  beforeEach(() => {
    db = createDrizzleMock()
    service = new AuthService(db as never, new TenantMembersService(db as never))
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('insere usuário novo com role student por padrão', async () => {
    // awaits: select existente (vazio) → insert → select final
    withQueryResults(
      db,
      [],
      [],
      [{ uid: 'uid-1', email: 'a@x.com', roles: ['student'], disabled: false }]
    )

    const result = await service.upsertUser({ uid: 'uid-1', email: 'a@x.com' })

    expect(db.insert).toHaveBeenCalledTimes(1)
    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'uid-1', roles: [Role.student] })
    )
    expect(result.roles).toEqual(['student'])
  })

  it('não sobrescreve roles existentes com array vazio no update', async () => {
    withQueryResults(
      db,
      [
        {
          uid: 'uid-1',
          email: 'a@x.com',
          displayName: 'A',
          photoUrl: null,
          roles: ['admin'],
          disabled: false,
        },
      ],
      [],
      [{ uid: 'uid-1', email: 'a@x.com', roles: ['admin'], disabled: false }]
    )

    await service.upsertUser({ uid: 'uid-1', email: 'a@x.com', roles: [] })

    expect(db.update).toHaveBeenCalledTimes(1)
    // roles vazias (e disabled ausente) ficam fora do SET: a linha guarda o que já tem, sem regravar o valor lido
    expect(db.set.mock.calls[0][0]).not.toHaveProperty('roles')
    expect(db.set.mock.calls[0][0]).not.toHaveProperty('disabled')
  })

  describe('upsertUser no login (B1: a correção de nome dura)', () => {
    const existente = (over: Record<string, unknown> = {}) => ({
      uid: 'uid-1', email: 'a@x.com', displayName: 'Nome Corrigido', photoUrl: 'polos/foto.png', roles: ['student'], disabled: false, ...over,
    })

    // Nome e foto: só preenchem o vazio (null, '' ou só espaços), decididos pelo MySQL na linha atual. O valor lido
    // antes nunca é regravado, senão uma correção gravada no meio do caminho seria desfeita (o efeito, contra o MySQL
    // real, está no auth-tenant.int-spec: B1).
    const SO_O_VAZIO = (coluna: string) => `CASE WHEN COALESCE(TRIM(\`users\`.\`${coluna}\`), '') = '' THEN ? ELSE \`users\`.\`${coluna}\` END`

    it('nome e foto entram como CASE sobre a linha atual: o valor do corpo ou do Firebase só ocupa o vazio', async () => {
      withQueryResults(db, [existente()], [], [existente()])
      await service.upsertUser({ uid: 'uid-1', email: 'novo@x.com', displayName: 'Nome do Google', photoUrl: 'https://google/foto.png' })
      const set = db.set.mock.calls[0][0] as Record<string, unknown>
      expect(set.email).toBe('novo@x.com')
      expect(renderSql(set.displayName)).toEqual({ sql: SO_O_VAZIO('display_name'), params: ['Nome do Google'] })
      expect(renderSql(set.photoUrl)).toEqual({ sql: SO_O_VAZIO('photo_url'), params: ['https://google/foto.png'] })
    })

    it('sem nada para preencher, o vazio continua vazio (null)', async () => {
      withQueryResults(db, [existente({ displayName: '', photoUrl: null })], [], [existente()])
      await service.upsertUser({ uid: 'uid-1', email: 'a@x.com', displayName: '', photoUrl: '' })
      const set = db.set.mock.calls[0][0] as Record<string, unknown>
      expect(renderSql(set.displayName).params).toEqual([null])
      expect(renderSql(set.photoUrl).params).toEqual([null])
    })

    it('papéis e desativação só entram no SET quando vêm no pedido, nunca o valor lido', async () => {
      withQueryResults(db, [existente({ disabled: true })], [], [existente()])
      await service.upsertUser({ uid: 'uid-1', email: 'a@x.com', displayName: 'X' })
      expect(db.set.mock.calls[0][0]).not.toHaveProperty('disabled')
      expect(db.set.mock.calls[0][0]).not.toHaveProperty('roles')
      withQueryResults(db, [existente()], [], [existente()])
      await service.upsertUser({ uid: 'uid-1', email: 'a@x.com', roles: [Role.teacher], disabled: true })
      expect(db.set.mock.calls[1][0]).toMatchObject({ roles: [Role.teacher], disabled: true })
    })
  })

  it('getUserByUid retorna null quando não existe', async () => {
    withQueryResults(db, [])
    const result = await service.getUserByUid('nope')
    expect(result).toBeNull()
  })

  describe('ensureUserRow', () => {
    it('cria o usuário espelhado quando ainda não existe, com o nome informado', async () => {
      // awaits: getUserByUid (vazio) → upsert: select existente (vazio) → insert → select final
      const criado = { uid: 'uid-1', email: 'a@x.com', displayName: 'Ana', photoUrl: null, roles: ['student'], disabled: false }
      withQueryResults(db, [], [], [], [criado])
      const row = await service.ensureUserRow({ uid: 'uid-1', email: 'a@x.com', displayName: 'Ana' })
      expect(db.insert).toHaveBeenCalledTimes(1)
      expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ uid: 'uid-1', email: 'a@x.com', displayName: 'Ana' }))
      expect(row).toEqual(criado)
    })

    it('nunca altera um cadastro que já existe (nome, e-mail e papéis ficam como estão)', async () => {
      const existente = { uid: 'uid-1', email: 'a@x.com', displayName: 'Nome de Sempre', photoUrl: null, roles: ['admin'], disabled: false }
      withQueryResults(db, [existente])
      const row = await service.ensureUserRow({ uid: 'uid-1', email: 'outro@x.com', displayName: 'Outro Nome' })
      expect(row).toEqual(existente)
      expect(db.insert).not.toHaveBeenCalled()
      expect(db.update).not.toHaveBeenCalled()
    })
  })

  describe('listMembers', () => {
    it('listMembers traz só membros do polo, com os papéis do polo', async () => {
      withQueryResults(db, [{ n: 1 }], [{ user: { uid: 'u1', email: 'a@x', displayName: 'A', photoUrl: null, isPlatformAdmin: false }, roles: ['teacher'] }])
      const r = await service.listMembers('t-a', {})
      expect(r.users[0].roles).toEqual(['teacher'])
      expect(allWheres(db.where)[1].sql).toContain('`tenant_members`.`tenant_id` = ?')
    })

    it('sem paginação devolve todos os membros (sem limit/offset) e o total', async () => {
      // awaits: count → rows
      withQueryResults(
        db,
        [{ n: 2 }],
        [
          { user: { uid: 'u1', email: 'a@x.com', displayName: 'A', photoUrl: null, roles: ['admin'], disabled: false }, roles: ['student'] },
          { user: { uid: 'u2', email: 'b@x.com', displayName: null, photoUrl: null, roles: ['student'], disabled: false }, roles: ['admin', 'teacher'] },
        ]
      )

      const result = await service.listMembers('t-a')

      expect(db.limit).not.toHaveBeenCalled()
      expect(db.offset).not.toHaveBeenCalled()
      // Os papéis vêm do vínculo com o polo, nunca da coluna global `users.roles`.
      expect(result).toEqual({
        total: 2,
        users: [
          { uid: 'u1', email: 'a@x.com', displayName: 'A', photoUrl: null, roles: ['student'], isPlatformAdmin: false },
          { uid: 'u2', email: 'b@x.com', displayName: null, photoUrl: null, roles: ['admin', 'teacher'], isPlatformAdmin: false },
        ],
      })
    })

    it('com paginação aplica limit/offset e devolve { users, total }', async () => {
      withQueryResults(
        db,
        [{ n: 5 }],
        [{ user: { uid: 'u3', email: 'c@x.com', displayName: 'C', photoUrl: null, disabled: false }, roles: ['student'] }]
      )

      const result = await service.listMembers('t-a', { page: 2, pageSize: 2 })

      expect(db.limit).toHaveBeenCalledWith(2)
      expect(db.offset).toHaveBeenCalledWith(2) // (2 - 1) * 2
      expect(result.total).toBe(5)
      expect(result.users).toEqual([
        { uid: 'u3', email: 'c@x.com', displayName: 'C', photoUrl: null, roles: ['student'], isPlatformAdmin: false },
      ])
    })

    it('a contagem e a lista filtram pelo polo; sem busca o filtro é só o do polo', async () => {
      // O mock devolve a fila qualquer que seja o WHERE: só o SQL prova que as DUAS consultas
      // (o total e a página) ficam presas ao polo, senão o total contaria a rede inteira.
      withQueryResults(db, [{ n: 0 }], [])
      await service.listMembers('t-a', { page: 1, pageSize: 20 })
      expect(allWheres(db.where)).toEqual([
        { sql: '`tenant_members`.`tenant_id` = ?', params: ['t-a'] },
        { sql: '`tenant_members`.`tenant_id` = ?', params: ['t-a'] },
      ])
    })

    it('com busca soma nome OU e-mail ao filtro do polo, nas duas consultas', async () => {
      withQueryResults(
        db,
        [{ n: 1 }],
        [{ user: { uid: 'u1', email: 'ana@x.com', displayName: 'Ana', photoUrl: null, disabled: false }, roles: ['student'] }]
      )
      const result = await service.listMembers('t-a', { page: 1, pageSize: 20, q: 'ana' })
      const esperado = {
        sql: '(`tenant_members`.`tenant_id` = ? and (`users`.`email` like ? or `users`.`display_name` like ?))',
        params: ['t-a', '%ana%', '%ana%'],
      }
      expect(allWheres(db.where)).toEqual([esperado, esperado])
      expect(result.total).toBe(1)
    })

    it('isPlatformAdmin de cada membro é o efetivo: o sinal OU o admin no vínculo da matriz (B10)', async () => {
      withQueryResults(
        db,
        [{ n: 3 }],
        [
          { user: { uid: 'u-adm-m', email: 'a@x.com', displayName: 'A', photoUrl: null, isPlatformAdmin: false }, roles: ['teacher'], matrizRoles: ['admin'] },
          { user: { uid: 'u-plat', email: 'b@x.com', displayName: 'B', photoUrl: null, isPlatformAdmin: true }, roles: ['student'], matrizRoles: null },
          { user: { uid: 'u-prof-m', email: 'c@x.com', displayName: 'C', photoUrl: null, isPlatformAdmin: false }, roles: ['student'], matrizRoles: ['teacher'] },
        ]
      )
      const r = await service.listMembers('t-a')
      expect(r.users.map((u) => [u.uid, u.isPlatformAdmin])).toEqual([['u-adm-m', true], ['u-plat', true], ['u-prof-m', false]])
      // O vínculo da matriz entra por LEFT JOIN, preso à matriz: não muda quem aparece na lista.
      expect(renderSql(db.leftJoin.mock.calls[0][1])).toEqual({
        sql: '(`tm_matriz`.`user_uid` = `users`.`uid` and `tm_matriz`.`tenant_id` = ?)',
        params: [MATRIZ_TENANT_ID],
      })
    })

    it('a busca escapa os curingas do LIKE', async () => {
      withQueryResults(db, [{ n: 0 }], [])
      await service.listMembers('t-a', { q: '50%_' })
      expect(allWheres(db.where)[0].params).toEqual(['t-a', '%50\\%\\_%', '%50\\%\\_%'])
    })
  })

  describe('getMemberDetail', () => {
    const row = {
      uid: 'u1', email: 'ana@x.com', displayName: 'Ana Souza', photoUrl: null, roles: ['student'],
      disabled: false, cpf: '12345678909', createdAt: new Date('2026-01-02T00:00:00Z'),
    }

    it('devolve o perfil completo, com CPF, status e os papéis do polo', async () => {
      // O vínculo diz professor; a coluna global `users.roles` diz aluno: vale o do polo.
      withQueryResults(db, [{ roles: ['teacher'] }], [row])
      const d = await service.getMemberDetail({ tenantId: 't-a', isPlatformAdmin: false }, 'u1')
      expect(d).toEqual({
        uid: 'u1', email: 'ana@x.com', displayName: 'Ana Souza', photoUrl: null, roles: ['teacher'],
        isPlatformAdmin: false, disabled: false, cpf: '12345678909', createdAt: '2026-01-02T00:00:00.000Z',
      })
      expect(allWheres(db.where)[0]).toEqual({
        sql: '(`tenant_members`.`tenant_id` = ? and `tenant_members`.`user_uid` = ?)',
        params: ['t-a', 'u1'],
      })
    })

    it('quem não é do polo responde 404, sem nem ler o cadastro global', async () => {
      withQueryResults(db, [])
      const pedido = service.getMemberDetail({ tenantId: 't-a', isPlatformAdmin: false }, 'u-de-fora')
      await expect(pedido).rejects.toBeInstanceOf(NotFoundException)
      await expect(pedido).rejects.toThrow('Usuário não encontrado neste polo.')
      expect(db.select).toHaveBeenCalledTimes(1) // só o vínculo
    })

    it('vínculo sem cadastro correspondente também responde 404', async () => {
      withQueryResults(db, [{ roles: ['student'] }], [])
      await expect(service.getMemberDetail({ tenantId: 't-a', isPlatformAdmin: false }, 'u1')).rejects.toBeInstanceOf(NotFoundException)
    })

    describe('CPF de pessoa compartilhada sai mascarado para o polo (B2)', () => {
      const doPolo = { tenantId: 't-a', isPlatformAdmin: false }

      it('pessoa compartilhada: o admin do polo vê a máscara do documento público, nunca os dígitos', async () => {
        // awaits: vínculo → cadastro → compartilhada? (papel de equipe em outro polo) → vínculo da matriz
        withQueryResults(db, [{ roles: ['student'] }], [row], [{ tenantId: 't-b' }])
        const d = await service.getMemberDetail(doPolo, 'u1')
        expect(d.cpf).toBe('***.***.***-**')
        expect(allWheres(db.where)[2].params).toEqual(['u1', 't-a'])
      })

      it('vínculo passivo com outro polo (só o login lá, sem matrícula nem papel): já mascara (definição ampla)', async () => {
        // awaits: vínculo → cadastro → algum vínculo fora? (sim, o da matriz criado pelo login)
        withQueryResults(db, [{ roles: ['student'] }], [row], [{ tenantId: 'matriz' }])
        expect((await service.getMemberDetail(doPolo, 'u1')).cpf).toBe('***.***.***-**')
        expect(allWheres(db.where)[2].sql).not.toContain('JSON_CONTAINS')
      })

      it('pessoa exclusiva do polo: CPF inteiro', async () => {
        withQueryResults(db, [{ roles: ['student'] }], [row], [], [], [])
        expect((await service.getMemberDetail(doPolo, 'u1')).cpf).toBe('12345678909')
      })

      it('a plataforma vê tudo, e nem pergunta se a pessoa é compartilhada', async () => {
        withQueryResults(db, [{ roles: ['student'] }], [row])
        const d = await service.getMemberDetail({ tenantId: 't-a', isPlatformAdmin: true }, 'u1')
        expect(d.cpf).toBe('12345678909')
        expect(db.select).toHaveBeenCalledTimes(3) // vínculo, cadastro e o vínculo da matriz: sem consulta de compartilhada
      })

      it('sem CPF não há o que esconder: nem pergunta', async () => {
        withQueryResults(db, [{ roles: ['student'] }], [{ ...row, cpf: null }])
        expect((await service.getMemberDetail(doPolo, 'u1')).cpf).toBeNull()
        expect(db.select).toHaveBeenCalledTimes(3)
      })
    })

    it('admin da matriz aparece como da plataforma no detalhe de outro polo (B10)', async () => {
      // awaits: vínculo no polo → cadastro → vínculo na matriz
      withQueryResults(db, [{ roles: ['teacher'] }], [{ ...row, isPlatformAdmin: false }], [{ roles: ['admin'] }])
      const d = await service.getMemberDetail({ tenantId: 't-a', isPlatformAdmin: true }, 'u1')
      expect(d.isPlatformAdmin).toBe(true)
      expect(allWheres(db.where)[2]).toEqual({
        sql: '(`tenant_members`.`tenant_id` = ? and `tenant_members`.`user_uid` = ?)',
        params: [MATRIZ_TENANT_ID, 'u1'],
      })
    })

    it('no endereço da matriz, o próprio vínculo diz se é da plataforma, sem outra consulta', async () => {
      withQueryResults(db, [{ roles: ['admin'] }], [{ ...row, isPlatformAdmin: false }])
      const d = await service.getMemberDetail({ tenantId: MATRIZ_TENANT_ID, isPlatformAdmin: true }, 'u1')
      expect(d.isPlatformAdmin).toBe(true)
      expect(db.select).toHaveBeenCalledTimes(2)
    })
  })

  describe('setTenantRoles', () => {
    const userRow = { uid: 'u1', email: 'a@x.com', displayName: 'A', photoUrl: null, roles: ['student'], disabled: false }

    it('o polo não fica sem admin', async () => {
      withQueryResults(db, [{ roles: ['admin'] }], [{ n: 0 }])
      await expect(service.setTenantRoles(adminDoPolo, 'outro-admin', ['teacher'] as never)).rejects.toThrow(BadRequestException)
    })

    it('usuário de outro polo responde 404 e nada é gravado', async () => {
      // O cadastro global existe (a pessoa é da rede), mas não há vínculo com ESTE polo: sem o
      // vínculo, o 404 vem antes de qualquer outra coisa e ninguém é puxado para o polo.
      withQueryResults(db, [], [userRow])
      const pedido = service.setTenantRoles(adminDoPolo, 'u-de-fora', [Role.teacher])
      await expect(pedido).rejects.toBeInstanceOf(NotFoundException)
      await expect(pedido).rejects.toThrow('Usuário não encontrado neste polo.')
      expect(db.select).toHaveBeenCalledTimes(1) // só o vínculo
      expect(db.insert).not.toHaveBeenCalled()
      expect(db.update).not.toHaveBeenCalled()
    })

    it('grava os papéis no vínculo do polo, devolve AuthUser e não toca na coluna global users.roles', async () => {
      withQueryResults(db, [{ roles: ['student'] }], [userRow])
      const result = await service.setTenantRoles(adminDoPolo, 'u1', [Role.teacher])
      expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-a', userUid: 'u1', roles: [Role.teacher] }))
      expect(db.onDuplicateKeyUpdate).toHaveBeenCalledWith({ set: { roles: [Role.teacher], updatedAt: expect.any(Date) } })
      expect(db.update).not.toHaveBeenCalled()
      expect(result).toEqual({ uid: 'u1', email: 'a@x.com', displayName: 'A', photoUrl: null, roles: ['teacher'], isPlatformAdmin: false })
    })

    it('o vínculo é lido do polo do ator', async () => {
      withQueryResults(db, [{ roles: ['student'] }], [userRow])
      await service.setTenantRoles(adminDoPolo, 'u1', [Role.teacher])
      expect(allWheres(db.where)[0]).toEqual({
        sql: '(`tenant_members`.`tenant_id` = ? and `tenant_members`.`user_uid` = ?)',
        params: ['t-a', 'u1'],
      })
    })

    it('bloqueia remover o papel admin quando não há outro admin no polo, sem gravar nada', async () => {
      // awaits: vínculo (admin) → cadastro → vínculo da matriz (é conta da plataforma?) → admins do polo, travados (só ele)
      withQueryResults(db, [{ roles: ['admin'] }], [userRow], [], [{ uid: 'u1' }])
      const pedido = service.setTenantRoles(adminDoPolo, 'u1', [Role.student])
      await expect(pedido).rejects.toBeInstanceOf(BadRequestException)
      await expect(pedido).rejects.toThrow('O polo precisa de ao menos um admin.')
      expect(db.insert).not.toHaveBeenCalled()
    })

    it('a conferência dos admins do polo e a gravação são uma transação, com os vínculos travados (FOR UPDATE)', async () => {
      withQueryResults(db, [{ roles: ['admin'] }], [userRow], [], [{ uid: 'u1' }, { uid: 'u2' }])
      await service.setTenantRoles(adminDoPolo, 'u1', [Role.student])
      expect(db.transaction).toHaveBeenCalledTimes(1)
      expect(allWheres(db.where)[3]).toEqual({
        sql: `(\`tenant_members\`.\`tenant_id\` = ? and JSON_CONTAINS(\`tenant_members\`.\`roles\`, '"admin"'))`,
        params: ['t-a'],
      })
      expect(db.for).toHaveBeenCalledWith('update')
    })

    it('o próprio alvo não conta como "outro admin": sozinho, não sai', async () => {
      withQueryResults(db, [{ roles: ['admin'] }], [userRow], [], [{ uid: 'u1' }])
      await expect(service.setTenantRoles(adminDoPolo, 'u1', [Role.student])).rejects.toThrow('O polo precisa de ao menos um admin.')
      expect(db.insert).not.toHaveBeenCalled()
    })

    it('permite rebaixar um admin quando existe outro admin no polo', async () => {
      withQueryResults(db, [{ roles: ['admin'] }], [userRow], [], [{ uid: 'u1' }, { uid: 'u2' }])
      const result = await service.setTenantRoles(adminDoPolo, 'u1', [Role.student])
      expect(result.roles).toEqual(['student'])
      expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ roles: [Role.student] }))
    })

    it('não consulta a contagem quando o alvo continua admin', async () => {
      // awaits: vínculo → cadastro → vínculo na matriz (para o isPlatformAdmin efetivo), SEM a contagem no meio
      withQueryResults(db, [{ roles: ['admin'] }], [userRow])
      const result = await service.setTenantRoles(adminDoPolo, 'u1', [Role.admin, Role.teacher])
      expect(result.roles).toEqual(['admin', 'teacher'])
      expect(db.select).toHaveBeenCalledTimes(3)
      expect(allWheres(db.where).some((w) => w.sql.includes('JSON_CONTAINS'))).toBe(false)
    })

    it('não consulta a contagem quando o alvo ainda não era admin (promoção)', async () => {
      withQueryResults(db, [{ roles: ['student'] }], [userRow])
      await service.setTenantRoles(adminDoPolo, 'u1', [Role.admin])
      expect(db.select).toHaveBeenCalledTimes(3)
      expect(allWheres(db.where).some((w) => w.sql.includes('JSON_CONTAINS'))).toBe(false)
    })

    it('a plataforma pode remover o último admin do polo (ela própria age como admin lá)', async () => {
      withQueryResults(db, [{ roles: ['admin'] }], [userRow])
      const result = await service.setTenantRoles(plataforma, 'u1', [Role.student])
      expect(result.roles).toEqual(['student'])
      expect(allWheres(db.where).some((w) => w.sql.includes('JSON_CONTAINS'))).toBe(false) // sem contagem
      expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ roles: [Role.student] }))
    })

    it('conta da plataforma vinculada ao polo: o admin do polo não troca os papéis dela (B4), e nada é gravado', async () => {
      withQueryResults(db, [{ roles: ['teacher'] }], [userRow], [{ roles: ['admin'] }])
      await expect(service.setTenantRoles(adminDoPolo, 'u1', [Role.student])).rejects.toMatchObject({
        response: { statusCode: 403, code: 'PLATFORM_ACCOUNT', message: 'Esta conta é da equipe do Studio Pilari e não pode ser alterada pelo polo.' },
      })
      expect(db.insert).not.toHaveBeenCalled()
    })

    it('a plataforma troca os papéis da conta da plataforma no polo', async () => {
      withQueryResults(db, [{ roles: ['teacher'] }], [userRow], [{ roles: ['admin'] }])
      const r = await service.setTenantRoles(plataforma, 'u1', [Role.student])
      expect(r).toMatchObject({ roles: ['student'], isPlatformAdmin: true })
    })

    describe('na matriz (B10: o admin da matriz é o da plataforma pela tela)', () => {
      it('nem a plataforma tira o último admin da matriz: 409, e nada é gravado', async () => {
        // awaits: vínculo (admin) → cadastro → admins da matriz, travados (só ele)
        withQueryResults(db, [{ roles: ['admin'] }], [userRow], [{ uid: 'u1' }])
        const pedido = service.setTenantRoles(plataformaNaMatriz, 'u1', [Role.student])
        await expect(pedido).rejects.toBeInstanceOf(ConflictException)
        await expect(pedido).rejects.toMatchObject({
          response: { statusCode: 409, code: 'LAST_ADMIN', message: 'A matriz precisa de ao menos um admin. Dê o papel de admin a outra pessoa antes de tirar o desta.' },
        })
        expect(db.insert).not.toHaveBeenCalled()
        expect(allWheres(db.where)[2]).toEqual({
          sql: `(\`tenant_members\`.\`tenant_id\` = ? and JSON_CONTAINS(\`tenant_members\`.\`roles\`, '"admin"'))`,
          params: [MATRIZ_TENANT_ID],
        })
        expect(db.for).toHaveBeenCalledWith('update')
      })

      it('com outro admin na matriz, sai; e o devolvido já não é da plataforma', async () => {
        withQueryResults(db, [{ roles: ['admin'] }], [userRow], [{ uid: 'u1' }, { uid: 'u-outro' }])
        const r = await service.setTenantRoles(plataformaNaMatriz, 'u1', [Role.teacher])
        expect(r).toMatchObject({ roles: ['teacher'], isPlatformAdmin: false })
        expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ tenantId: MATRIZ_TENANT_ID, roles: [Role.teacher] }))
      })

      it('dar admin na matriz devolve a pessoa já como da plataforma, sem consultar outro vínculo', async () => {
        withQueryResults(db, [{ roles: ['student'] }], [userRow])
        const r = await service.setTenantRoles(plataformaNaMatriz, 'u1', [Role.admin])
        expect(r).toMatchObject({ roles: ['admin'], isPlatformAdmin: true })
        expect(db.select).toHaveBeenCalledTimes(2)
      })
    })
  })
})

describe('AuthService — perfil do aluno pelo admin', () => {
  let db: DrizzleMock
  let service: AuthService

  beforeEach(() => {
    db = createDrizzleMock()
    service = new AuthService(db as never, new TenantMembersService(db as never))
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  const row = {
    uid: 'u1', email: 'ana@x.com', displayName: 'Ana Souza', photoUrl: null, roles: ['student'],
    disabled: false, cpf: '12345678909', createdAt: new Date('2026-01-02T00:00:00Z'),
  }

  // Ordem das consultas: vínculo com o polo → cadastro → vínculo da matriz (a conta é da plataforma? B4) → é
  // compartilhada? (papel de equipe, matrícula e certificado em OUTRO polo; três vazias = exclusiva do polo; só para quem
  // não é da plataforma) → (update) → cadastro de novo.
  const exclusivo: unknown[] = [[], [], []]
  const doPolo = (cadastro: unknown, ...resto: unknown[]) => withQueryResults(db, [{ roles: ['student'] }], cadastro, [], ...exclusivo, ...resto)
  const MSG_COMPARTILHADO = 'Esta pessoa também está ligada a outro polo da rede. Nome e CPF vão para os certificados de todos os polos dela; quem corrige é o Studio Pilari.'
  const MSG_PLATAFORMA = 'Esta conta é da equipe do Studio Pilari e não pode ser alterada pelo polo.'

  it('adminUpdateUser SOBRESCREVE CPF já gravado (o aluno não pode, o admin pode corrigir)', async () => {
    doPolo([row], [], [{ ...row, cpf: '52998224725' }])
    const d = await service.adminUpdateUser(adminDoPolo, 'u1', { cpf: '529.982.247-25' })
    expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ cpf: '52998224725' }))
    expect(d.cpf).toBe('52998224725')
  })

  it('CPF com dígito verificador errado → 400 e nada gravado', async () => {
    doPolo([row])
    await expect(service.adminUpdateUser(adminDoPolo, 'u1', { cpf: '123.456.789-00' })).rejects.toBeInstanceOf(BadRequestException)
    expect(db.update).not.toHaveBeenCalled()
  })

  it('CPF com todos os dígitos iguais → 400', async () => {
    doPolo([row])
    await expect(service.adminUpdateUser(adminDoPolo, 'u1', { cpf: '111.111.111-11' })).rejects.toBeInstanceOf(BadRequestException)
    expect(db.update).not.toHaveBeenCalled()
  })

  it('nome que é um e-mail → 400 (e-mail nunca é nome, vai impresso no certificado)', async () => {
    doPolo([row])
    await expect(service.adminUpdateUser(adminDoPolo, 'u1', { displayName: 'ana@x.com' })).rejects.toBeInstanceOf(BadRequestException)
    expect(db.update).not.toHaveBeenCalled()
  })

  it('nome curto demais → 400', async () => {
    doPolo([row])
    await expect(service.adminUpdateUser(adminDoPolo, 'u1', { displayName: ' A ' })).rejects.toBeInstanceOf(BadRequestException)
    expect(db.update).not.toHaveBeenCalled()
  })

  it('sem nome nem CPF → 400 "Nada para alterar."', async () => {
    doPolo([row])
    await expect(service.adminUpdateUser(adminDoPolo, 'u1', {})).rejects.toThrow('Nada para alterar.')
    expect(db.update).not.toHaveBeenCalled()
  })

  it('só grava o que foi enviado: nome sem CPF não toca no CPF', async () => {
    doPolo([row], [], [{ ...row, displayName: 'Ana Maria Souza' }])
    const d = await service.adminUpdateUser(adminDoPolo, 'u1', { displayName: '  Ana   Maria Souza ' })
    const set = db.set.mock.calls[0][0] as Record<string, unknown>
    expect(set.displayName).toBe('Ana Maria Souza')
    expect('cpf' in set).toBe(false)
    expect(d.displayName).toBe('Ana Maria Souza')
  })

  it('o retorno traz os papéis do polo, não a coluna global users.roles', async () => {
    withQueryResults(db, [{ roles: ['teacher'] }], [row], [], ...exclusivo, [], [{ ...row, displayName: 'Ana Maria Souza' }])
    const d = await service.adminUpdateUser(adminDoPolo, 'u1', { displayName: 'Ana Maria Souza' })
    expect(d.roles).toEqual(['teacher'])
  })

  it('usuário de outro polo responde 404', async () => {
    withQueryResults(db, [])
    await expect(service.adminUpdateUser(adminDoPolo, 'u-de-fora', { displayName: 'X' })).rejects.toThrow(NotFoundException)
  })

  it('usuário de outro polo: mensagem em português, sem contar os polos dele, sem gravar e com o vínculo buscado no polo do ator', async () => {
    withQueryResults(db, [])
    const pedido = service.adminUpdateUser(adminDoPolo, 'u-de-fora', { displayName: 'X' })
    await expect(pedido).rejects.toThrow(NotFoundException)
    await expect(pedido).rejects.toThrow('Usuário não encontrado neste polo.')
    expect(db.select).toHaveBeenCalledTimes(1) // só o vínculo
    expect(db.update).not.toHaveBeenCalled()
    // O vínculo é buscado no polo do ator, não em qualquer polo.
    expect(allWheres(db.where)[0]).toEqual({
      sql: '(`tenant_members`.`tenant_id` = ? and `tenant_members`.`user_uid` = ?)',
      params: ['t-a', 'u-de-fora'],
    })
  })

  it('pessoa compartilhada: admin do polo não corrige nome nem CPF', async () => {
    // Papel de equipe em outro polo.
    withQueryResults(db, [{ roles: ['student'] }], [row], [], [{ tenantId: 't-b' }])
    await expect(service.adminUpdateUser(adminDoPolo, 'u1', { displayName: 'Novo Nome' })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'SHARED_USER_PLATFORM_ONLY' }),
    })
  })

  it('pessoa compartilhada: a recusa é 403 com a mensagem em português, vale para o CPF e não grava nada', async () => {
    // Matrícula num curso de outro polo.
    withQueryResults(db, [{ roles: ['student'] }], [row], [], [], [{ id: 'e1' }])
    const pedido = service.adminUpdateUser(adminDoPolo, 'u1', { cpf: '529.982.247-25' })
    await expect(pedido).rejects.toBeInstanceOf(ForbiddenException)
    await expect(pedido).rejects.toMatchObject({
      response: { statusCode: 403, code: 'SHARED_USER_PLATFORM_ONLY', message: MSG_COMPARTILHADO },
    })
    expect(db.update).not.toHaveBeenCalled()
    // Compartilhada é vista do polo do ATOR: o que conta é o que a pessoa tem fora dele.
    expect(allWheres(db.where).slice(3, 5).map((w) => w.params)).toEqual([['u1', 't-a'], ['u1', 't-a']])
  })

  it('certificado de um curso de outro polo também torna a pessoa compartilhada', async () => {
    withQueryResults(db, [{ roles: ['student'] }], [row], [], [], [], [{ id: 'c1' }])
    await expect(service.adminUpdateUser(adminDoPolo, 'u1', { displayName: 'Novo Nome' })).rejects.toMatchObject({
      response: { code: 'SHARED_USER_PLATFORM_ONLY', message: MSG_COMPARTILHADO },
    })
    expect(db.update).not.toHaveBeenCalled()
  })

  it('aluno compartilhado: a plataforma corrige nome e CPF (e nem pergunta se é compartilhada)', async () => {
    withQueryResults(db, [{ roles: ['student'] }], [row], [], [], [{ ...row, displayName: 'Nome Corrigido', cpf: '52998224725' }])
    const d = await service.adminUpdateUser(plataforma, 'u1', { displayName: 'Nome Corrigido', cpf: '529.982.247-25' })
    expect(d).toMatchObject({ displayName: 'Nome Corrigido', cpf: '52998224725' })
    expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Nome Corrigido', cpf: '52998224725' }))
    // vínculo, cadastro, vínculo da matriz e cadastro de novo: nenhuma consulta de compartilhada
    expect(db.select).toHaveBeenCalledTimes(4)
    expect(allWheres(db.where).some((w) => w.sql.includes('<> ?'))).toBe(false)
  })

  it('o cadastro que sumiu depois do vínculo responde 404 e nada é gravado', async () => {
    withQueryResults(db, [{ roles: ['student'] }], [])
    await expect(service.adminUpdateUser(adminDoPolo, 'u1', { displayName: 'Ana Souza' })).rejects.toBeInstanceOf(NotFoundException)
    expect(db.update).not.toHaveBeenCalled()
  })

  describe('conta da equipe do Studio Pilari (B4)', () => {
    it('o admin do polo não edita a conta de quem é admin da matriz: 403 PLATFORM_ACCOUNT e nada gravado', async () => {
      withQueryResults(db, [{ roles: ['teacher'] }], [row], [{ roles: ['admin'] }])
      const pedido = service.adminUpdateUser(adminDoPolo, 'u1', { displayName: 'Outro Nome' })
      await expect(pedido).rejects.toBeInstanceOf(ForbiddenException)
      await expect(pedido).rejects.toMatchObject({ response: { statusCode: 403, code: 'PLATFORM_ACCOUNT', message: MSG_PLATAFORMA } })
      expect(db.update).not.toHaveBeenCalled()
    })

    it('nem a de quem tem o sinal da plataforma (e o sinal decide sem ler a matriz)', async () => {
      withQueryResults(db, [{ roles: ['student'] }], [{ ...row, isPlatformAdmin: true }])
      await expect(service.adminUpdateUser(adminDoPolo, 'u1', { cpf: '529.982.247-25' })).rejects.toMatchObject({ response: { code: 'PLATFORM_ACCOUNT' } })
      expect(db.select).toHaveBeenCalledTimes(2)
      expect(db.update).not.toHaveBeenCalled()
    })

    it('a plataforma edita a conta da plataforma; o devolvido segue marcado como da plataforma', async () => {
      withQueryResults(db, [{ roles: ['student'] }], [{ ...row, isPlatformAdmin: true }], [], [{ ...row, isPlatformAdmin: true, displayName: 'Nome Novo' }])
      const d = await service.adminUpdateUser(plataforma, 'u1', { displayName: 'Nome Novo' })
      expect(d).toMatchObject({ displayName: 'Nome Novo', isPlatformAdmin: true })
    })
  })
})

describe('AuthService.updateProfile — o próprio perfil (B8: pessoa compartilhada)', () => {
  let db: DrizzleMock
  let service: AuthService

  beforeEach(() => {
    db = createDrizzleMock()
    service = new AuthService(db as never, new TenantMembersService(db as never))
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  const quem = { tenantId: 't-a', isPlatformAdmin: false }
  const cadastro = { uid: 'u1', email: 'ana@x.com', displayName: 'Ana Souza', photoUrl: null, headline: null, bio: null, cpf: '52998224725' }
  const MSG = 'Seu nome e CPF vão para certificados de mais de um polo. Para corrigir, fale com o Studio Pilari.'
  // Papel de equipe em dois polos: a primeira consulta já decide.
  const compartilhada: unknown[] = [[{ tenantId: 't-a' }, { tenantId: 't-b' }]]
  // Relações reais num polo só (a matrícula no A), de qualquer endereço.
  const exclusiva: unknown[] = [[], [{ tenantId: 't-a' }], []]

  it('pessoa compartilhada não troca o nome já preenchido: 403 e nada gravado', async () => {
    withQueryResults(db, [cadastro], ...compartilhada)
    const pedido = service.updateProfile(quem, 'u1', { displayName: 'Outro Nome' })
    await expect(pedido).rejects.toBeInstanceOf(ForbiddenException)
    await expect(pedido).rejects.toMatchObject({ response: { statusCode: 403, code: 'SHARED_USER_PLATFORM_ONLY', message: MSG } })
    expect(db.update).not.toHaveBeenCalled()
    // O endereço não entra na conta: só a pessoa.
    expect(allWheres(db.where)[1].params).toEqual(['u1'])
  })

  it('o endereço não decide: relações reais num polo só deixam trocar o nome mesmo pelo site da matriz', async () => {
    withQueryResults(db, [cadastro], ...exclusiva, [], [{ ...cadastro, displayName: 'Ana Maria Souza' }])
    await service.updateProfile({ tenantId: 't-matriz', isPlatformAdmin: false }, 'u1', { displayName: 'Ana Maria Souza' })
    expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Ana Maria Souza' }))
  })

  it('matrícula num polo e certificado em outro: compartilhada, de qualquer endereço', async () => {
    withQueryResults(db, [cadastro], [], [{ tenantId: 't-a' }], [{ tenantId: 't-b' }])
    await expect(service.updateProfile({ tenantId: 't-a', isPlatformAdmin: false }, 'u1', { displayName: 'Outro Nome' })).rejects.toMatchObject({
      response: { code: 'SHARED_USER_PLATFORM_ONLY' },
    })
    expect(db.update).not.toHaveBeenCalled()
  })

  it('pessoa compartilhada não troca o CPF já preenchido por outro: 403', async () => {
    withQueryResults(db, [cadastro], ...compartilhada)
    await expect(service.updateProfile(quem, 'u1', { cpf: '111.444.777-35' })).rejects.toMatchObject({ response: { code: 'SHARED_USER_PLATFORM_ONLY' } })
    expect(db.update).not.toHaveBeenCalled()
  })

  it('pessoa compartilhada preenche o CPF vazio (e o nome vazio)', async () => {
    withQueryResults(db, [{ ...cadastro, cpf: null, displayName: null }], [], [{ ...cadastro, displayName: 'Ana Souza' }])
    await service.updateProfile(quem, 'u1', { cpf: '529.982.247-25', displayName: 'Ana Souza' })
    expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ cpf: '52998224725', displayName: 'Ana Souza' }))
    // Preencher não é trocar: nem pergunta se é compartilhada.
    expect(db.select).toHaveBeenCalledTimes(2)
  })

  it('reenviar o mesmo nome (a tela do instrutor manda o nome junto com a bio) não é troca: a bio grava', async () => {
    withQueryResults(db, [cadastro], [], [{ ...cadastro, bio: 'Nova bio' }])
    await service.updateProfile(quem, 'u1', { displayName: ' Ana Souza ', bio: 'Nova bio', cpf: '52998224725' })
    const set = db.set.mock.calls[0][0] as Record<string, unknown>
    expect(set.bio).toBe('Nova bio')
    expect('displayName' in set).toBe(false)
    expect('cpf' in set).toBe(false)
    expect(db.select).toHaveBeenCalledTimes(2) // sem consulta de compartilhada
  })

  it('pessoa exclusiva do polo troca o nome como antes; o CPF já gravado continua ignorado em silêncio', async () => {
    withQueryResults(db, [cadastro], ...exclusiva, [], [{ ...cadastro, displayName: 'Ana Maria Souza' }])
    const r = await service.updateProfile(quem, 'u1', { displayName: 'Ana Maria Souza', cpf: '111.444.777-35' })
    const set = db.set.mock.calls[0][0] as Record<string, unknown>
    expect(set.displayName).toBe('Ana Maria Souza')
    expect('cpf' in set).toBe(false)
    expect(r.displayName).toBe('Ana Maria Souza')
  })

  it('o Studio Pilari não é barrada no próprio perfil: ela é quem corrige', async () => {
    withQueryResults(db, [cadastro], [], [{ ...cadastro, displayName: 'Outro Nome' }])
    await service.updateProfile({ tenantId: 't-a', isPlatformAdmin: true }, 'u1', { displayName: 'Outro Nome' })
    expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Outro Nome' }))
    expect(db.select).toHaveBeenCalledTimes(2)
  })
})
