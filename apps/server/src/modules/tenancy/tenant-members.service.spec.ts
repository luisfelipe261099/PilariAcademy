import { Role } from '@pilari/types'
import { createDrizzleMock, withQueryResults } from '../../__test-utils__/drizzle-mock'
import { allWheres, renderSql } from '../../__test-utils__/sql'
import { TenantMembersService } from './tenant-members.service'
import { MATRIZ_TENANT_ID } from './tenancy.constants'

describe('TenantMembersService', () => {
  it('rolesOf devolve null sem vínculo e os papéis com vínculo', async () => {
    const db = createDrizzleMock()
    const svc = new TenantMembersService(db as never)
    withQueryResults(db, [], [{ roles: ['teacher', 'admin'] }])
    expect(await svc.rolesOf('t-a', 'u1')).toBeNull()
    expect(await svc.rolesOf('t-a', 'u1')).toEqual([Role.teacher, Role.admin])
    const w = allWheres(db.where)[0]
    expect(w.sql).toContain('`tenant_members`.`tenant_id` = ?')
    expect(w.params).toEqual(['t-a', 'u1'])
  })

  it('ensureStudent insere aluno sem rebaixar quem já é membro', async () => {
    const db = createDrizzleMock()
    await new TenantMembersService(db as never).ensureStudent('t-a', 'u1')
    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-a', userUid: 'u1', roles: [Role.student] }))
    const set = db.onDuplicateKeyUpdate.mock.calls[0][0].set as Record<string, unknown>
    expect(set).not.toHaveProperty('roles')
  })

  it('setRoles grava os papéis no upsert', async () => {
    const db = createDrizzleMock()
    await new TenantMembersService(db as never).setRoles('t-a', 'u1', [Role.admin])
    expect(db.onDuplicateKeyUpdate.mock.calls[0][0].set).toMatchObject({ roles: [Role.admin] })
  })

  describe('rolesHereAndInMatriz (o guard lê o polo e a matriz numa consulta só)', () => {
    it('separa os papéis do polo e os da matriz', async () => {
      const db = createDrizzleMock()
      withQueryResults(db, [
        { tenantId: 't-a', roles: ['teacher'] },
        { tenantId: MATRIZ_TENANT_ID, roles: ['admin', 'root'] },
      ])
      const r = await new TenantMembersService(db as never).rolesHereAndInMatriz('t-a', 'u1')
      expect(r).toEqual({ roles: [Role.teacher], matrizRoles: [Role.admin] })
      expect(db.select).toHaveBeenCalledTimes(1)
      expect(allWheres(db.where)).toEqual([
        { sql: '(`tenant_members`.`user_uid` = ? and `tenant_members`.`tenant_id` in (?, ?))', params: ['u1', 't-a', MATRIZ_TENANT_ID] },
      ])
    })

    it('sem vínculo em nenhum dos dois, null nos dois', async () => {
      const db = createDrizzleMock()
      withQueryResults(db, [])
      expect(await new TenantMembersService(db as never).rolesHereAndInMatriz('t-a', 'u1')).toEqual({ roles: null, matrizRoles: null })
    })

    it('no endereço da matriz, o vínculo do polo É o da matriz', async () => {
      const db = createDrizzleMock()
      withQueryResults(db, [{ tenantId: MATRIZ_TENANT_ID, roles: ['admin'] }])
      const r = await new TenantMembersService(db as never).rolesHereAndInMatriz(MATRIZ_TENANT_ID, 'u1')
      expect(r).toEqual({ roles: [Role.admin], matrizRoles: [Role.admin] })
      expect(allWheres(db.where)[0].params).toEqual(['u1', MATRIZ_TENANT_ID])
    })

    it('sem polo na requisição, só a matriz é lida', async () => {
      const db = createDrizzleMock()
      withQueryResults(db, [{ tenantId: MATRIZ_TENANT_ID, roles: ['student'] }])
      const r = await new TenantMembersService(db as never).rolesHereAndInMatriz(undefined, 'u1')
      expect(r).toEqual({ roles: null, matrizRoles: [Role.student] })
      expect(allWheres(db.where)[0].params).toEqual(['u1', MATRIZ_TENANT_ID])
    })
  })

  describe('isPlatformAdmin (admin da plataforma efetivo de qualquer pessoa)', () => {
    it('o sinal do cadastro ou o admin da matriz, numa consulta só', async () => {
      const db = createDrizzleMock()
      const svc = new TenantMembersService(db as never)
      withQueryResults(db, [{ flag: true, matrizRoles: null }], [{ flag: false, matrizRoles: ['admin'] }], [{ flag: false, matrizRoles: ['teacher'] }], [])
      expect(await svc.isPlatformAdmin('u-plat')).toBe(true)
      expect(await svc.isPlatformAdmin('u-adm-m')).toBe(true)
      expect(await svc.isPlatformAdmin('u-prof-m')).toBe(false)
      expect(await svc.isPlatformAdmin('u-sem-cadastro')).toBe(false)
      expect(db.select).toHaveBeenCalledTimes(4)
      // O vínculo procurado é o da MATRIZ (no JOIN), não o de qualquer polo.
      const join = db.leftJoin.mock.calls[0][1]
      expect(renderSql(join)).toEqual({
        sql: '(`tenant_members`.`user_uid` = `users`.`uid` and `tenant_members`.`tenant_id` = ?)',
        params: [MATRIZ_TENANT_ID],
      })
      expect(allWheres(db.where)[0]).toEqual({ sql: '`users`.`uid` = ?', params: ['u-plat'] })
    })
  })

  describe('isSharedPerson (regra do próprio perfil: relações reais em dois polos, de qualquer endereço)', () => {
    const service = (db: ReturnType<typeof createDrizzleMock>) => new TenantMembersService(db as never)

    it('papel de equipe em dois polos: compartilhada, numa consulta só', async () => {
      const db = createDrizzleMock()
      withQueryResults(db, [{ tenantId: 't-a' }, { tenantId: 't-b' }])
      expect(await service(db).isSharedPerson('u1')).toBe(true)
      expect(db.select).toHaveBeenCalledTimes(1)
      expect(allWheres(db.where)[0].params).toEqual(['u1'])
    })

    it('matrícula num polo e certificado em outro: compartilhada', async () => {
      const db = createDrizzleMock()
      withQueryResults(db, [], [{ tenantId: 't-a' }], [{ tenantId: 't-b' }])
      expect(await service(db).isSharedPerson('u1')).toBe(true)
      expect(allWheres(db.where)[1]).toEqual({ sql: '`enrollments`.`user_id` = ?', params: ['u1'] })
      expect(allWheres(db.where)[2]).toEqual({ sql: '`certificates`.`user_id` = ?', params: ['u1'] })
    })

    it('tudo no mesmo polo (professora e aluna do A, com certificado do A): não é compartilhada', async () => {
      const db = createDrizzleMock()
      withQueryResults(db, [{ tenantId: 't-a' }], [{ tenantId: 't-a' }], [{ tenantId: 't-a' }])
      expect(await service(db).isSharedPerson('u1')).toBe(false)
    })

    it('sem relação nenhuma (só vínculos passivos de login): não é compartilhada', async () => {
      const db = createDrizzleMock()
      withQueryResults(db, [], [], [])
      expect(await service(db).isSharedPerson('u1')).toBe(false)
      expect(db.select).toHaveBeenCalledTimes(3)
    })
  })

  describe('isLinkedOutside (definição ampla: CPF inteiro e senha)', () => {
    it('qualquer vínculo com outro polo basta, até o passivo do login (sem olhar os papéis), numa consulta só', async () => {
      const db = createDrizzleMock()
      withQueryResults(db, [{ tenantId: 'matriz' }])
      expect(await new TenantMembersService(db as never).isLinkedOutside('t-a', 'u1')).toBe(true)
      expect(db.select).toHaveBeenCalledTimes(1)
      expect(allWheres(db.where)[0]).toEqual({ sql: '(`tenant_members`.`user_uid` = ? and `tenant_members`.`tenant_id` <> ?)', params: ['u1', 't-a'] })
    })

    it('sem vínculo fora, ainda conta a relação real do CA-6 (matrícula ou certificado de antes dos vínculos)', async () => {
      const db = createDrizzleMock()
      // [vínculo fora: nenhum], [papel de equipe fora: nenhum], [matrícula fora: uma]
      withQueryResults(db, [], [], [{ id: 'e1' }])
      expect(await new TenantMembersService(db as never).isLinkedOutside('t-a', 'u1')).toBe(true)
    })

    it('exclusiva do polo: nenhum vínculo nem relação fora', async () => {
      const db = createDrizzleMock()
      withQueryResults(db, [], [], [], [])
      expect(await new TenantMembersService(db as never).isLinkedOutside('t-a', 'u1')).toBe(false)
      expect(db.select).toHaveBeenCalledTimes(4)
    })
  })

  describe('isSharedOutside (CA-6: pessoa compartilhada, vista do polo do endereço)', () => {
    it('papel de equipe (professor ou admin) em outro polo basta, e as outras consultas nem rodam', async () => {
      const db = createDrizzleMock()
      withQueryResults(db, [{ tenantId: 't-b' }])
      expect(await new TenantMembersService(db as never).isSharedOutside('t-a', 'u1')).toBe(true)
      expect(db.select).toHaveBeenCalledTimes(1)
      expect(allWheres(db.where)[0]).toEqual({
        sql: `(\`tenant_members\`.\`user_uid\` = ? and \`tenant_members\`.\`tenant_id\` <> ? and (JSON_CONTAINS(\`tenant_members\`.\`roles\`, '"admin"') or JSON_CONTAINS(\`tenant_members\`.\`roles\`, '"teacher"')))`,
        params: ['u1', 't-a'],
      })
    })

    it('matrícula (em qualquer situação) num curso de outro polo também', async () => {
      const db = createDrizzleMock()
      withQueryResults(db, [], [{ id: 'e1' }])
      expect(await new TenantMembersService(db as never).isSharedOutside('t-a', 'u1')).toBe(true)
      expect(db.select).toHaveBeenCalledTimes(2)
      expect(allWheres(db.where)[1]).toEqual({ sql: '(`enrollments`.`user_id` = ? and `courses`.`tenant_id` <> ?)', params: ['u1', 't-a'] })
      expect(renderSql(db.innerJoin.mock.calls[0][1]).sql).toBe('`courses`.`id` = `enrollments`.`course_id`')
    })

    it('certificado de um curso de outro polo também', async () => {
      const db = createDrizzleMock()
      withQueryResults(db, [], [], [{ id: 'c1' }])
      expect(await new TenantMembersService(db as never).isSharedOutside('t-a', 'u1')).toBe(true)
      expect(allWheres(db.where)[2]).toEqual({ sql: '(`certificates`.`user_id` = ? and `courses`.`tenant_id` <> ?)', params: ['u1', 't-a'] })
      expect(renderSql(db.innerJoin.mock.calls[1][1]).sql).toBe('`courses`.`id` = `certificates`.`course_id`')
    })

    it('só o vínculo de aluno criado ao visitar outro polo (sem matrícula, certificado nem papel de equipe) não torna compartilhado', async () => {
      const db = createDrizzleMock()
      withQueryResults(db, [], [], [])
      expect(await new TenantMembersService(db as never).isSharedOutside('t-a', 'u1')).toBe(false)
      expect(db.select).toHaveBeenCalledTimes(3)
    })
  })

  describe('assertNotPlatformAccount (B4: conta do Studio Pilari só a plataforma altera)', () => {
    it('quem não é da plataforma, sobre conta da plataforma: 403 PLATFORM_ACCOUNT', async () => {
      const db = createDrizzleMock()
      withQueryResults(db, [{ flag: false, matrizRoles: ['admin'] }])
      await expect(new TenantMembersService(db as never).assertNotPlatformAccount(false, 'u-adm-m')).rejects.toMatchObject({
        response: { statusCode: 403, code: 'PLATFORM_ACCOUNT', message: 'Esta conta é da equipe do Studio Pilari e não pode ser alterada pelo polo.' },
      })
    })
    it('sobre conta comum, passa', async () => {
      const db = createDrizzleMock()
      withQueryResults(db, [{ flag: false, matrizRoles: ['student'] }])
      await expect(new TenantMembersService(db as never).assertNotPlatformAccount(false, 'u1')).resolves.toBeUndefined()
    })
    it('a plataforma passa sem nem consultar', async () => {
      const db = createDrizzleMock()
      await expect(new TenantMembersService(db as never).assertNotPlatformAccount(true, 'u-plat')).resolves.toBeUndefined()
      expect(db.select).not.toHaveBeenCalled()
    })
  })

  describe('ensureStudentUnlessPlatform (B3: comprar garante o vínculo)', () => {
    it('quem não é da plataforma ganha o vínculo de aluno (o mesmo ensureStudent da cortesia)', async () => {
      const db = createDrizzleMock()
      withQueryResults(db, [{ flag: false, matrizRoles: null }])
      await new TenantMembersService(db as never).ensureStudentUnlessPlatform('t-a', 'u1')
      expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-a', userUid: 'u1', roles: [Role.student] }))
    })
    it('admin da plataforma (sinal ou admin da matriz) nunca vira aluno de polo', async () => {
      const db = createDrizzleMock()
      withQueryResults(db, [{ flag: true, matrizRoles: null }], [{ flag: false, matrizRoles: ['admin'] }])
      const svc = new TenantMembersService(db as never)
      await svc.ensureStudentUnlessPlatform('t-a', 'u-plat')
      await svc.ensureStudentUnlessPlatform('t-a', 'u-adm-m')
      expect(db.insert).not.toHaveBeenCalled()
    })
  })

  it('countAdmins conta pelo banco', async () => {
    const db = createDrizzleMock()
    const svc = new TenantMembersService(db as never)
    withQueryResults(db, [{ n: 1 }])
    expect(await svc.countAdmins('t-a', 'u1')).toBe(1)
    expect(allWheres(db.where)[0].sql).toContain('JSON_CONTAINS')
  })
})
