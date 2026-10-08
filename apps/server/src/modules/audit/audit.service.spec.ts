/// <reference types="jest" />
import { createDrizzleMock, withQueryResults, type DrizzleMock } from '../../__test-utils__/drizzle-mock'
import { allWheres, renderSql } from '../../__test-utils__/sql'
import { AuditService } from './audit.service'

function make() {
  const db: DrizzleMock = createDrizzleMock()
  return { db, service: new AuditService(db as never) }
}

describe('AuditService', () => {
  it('log dispara o insert', () => {
    const { db, service } = make()
    service.log({ tenantId: 't-a', action: 'x.y', summary: 'fez algo' })
    expect(db.insert).toHaveBeenCalled()
  })

  it('list mapeia para AuditLog', async () => {
    const { db, service } = make()
    withQueryResults(db, [
      { id: 'l1', actorEmail: 'a@x.com', action: 'payout.register', summary: 'repasse', targetType: null, targetId: null, createdAt: new Date('2026-06-25T12:00:00Z') },
    ])
    const res = await service.list(null)
    expect(res[0]).toEqual({ id: 'l1', actorEmail: 'a@x.com', action: 'payout.register', summary: 'repasse', targetType: null, targetId: null, createdAt: '2026-06-25T12:00:00.000Z' })
  })

  it('grava o polo da ação', async () => {
    const db = createDrizzleMock()
    const svc = new AuditService(db as never)
    svc.log({ tenantId: 't-a', actorUid: 'u1', actorEmail: null, action: 'x', summary: 'y' })
    await new Promise((r) => setImmediate(r))
    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-a', action: 'x' }))
  })

  it('list(tenantId) filtra pelo polo', async () => {
    const db = createDrizzleMock()
    withQueryResults(db, [])
    await new AuditService(db as never).list('t-a', 50)
    expect(allWheres(db.where)[0]).toEqual({ sql: '`audit_logs`.`tenant_id` = ?', params: ['t-a'] })
  })

  it('list(null) lista a plataforma inteira', async () => {
    const db = createDrizzleMock()
    withQueryResults(db, [])
    await new AuditService(db as never).list(null, 50)
    expect(db.where).not.toHaveBeenCalled()
  })

  describe('listPlatform', () => {
    const registro = (over: Record<string, unknown> = {}) => ({
      id: 'l1', actorEmail: 'a@x', action: 'course.approve', summary: 's', targetType: 'course', targetId: 'c1', createdAt: new Date('2026-10-01T00:00:00Z'), ...over,
    })

    it('listPlatform traz o polo (id e nome) de cada log', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ log: registro({ tenantId: 't-a' }), tenantName: 'Polo A' }])
      expect(await service.listPlatform()).toEqual([expect.objectContaining({ id: 'l1', tenantId: 't-a', tenantName: 'Polo A' })])
    })

    it('mapeia o registro inteiro e acrescenta o id e o nome do polo', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ log: registro({ tenantId: 't-a' }), tenantName: 'Polo A' }])
      expect(await service.listPlatform()).toEqual([{
        id: 'l1', actorEmail: 'a@x', action: 'course.approve', summary: 's', targetType: 'course', targetId: 'c1',
        createdAt: '2026-10-01T00:00:00.000Z', tenantId: 't-a', tenantName: 'Polo A',
      }])
    })

    it('ação da plataforma (sem polo) vem com tenantId e tenantName null e não some da lista', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ log: registro({ id: 'l2', action: 'tenant.create', tenantId: null }), tenantName: null }])
      expect(await service.listPlatform()).toEqual([expect.objectContaining({ id: 'l2', tenantId: null, tenantName: null })])
      // LEFT JOIN, não INNER: o log sem polo continua na lista.
      expect(db.leftJoin).toHaveBeenCalledTimes(1)
      expect(db.innerJoin).not.toHaveBeenCalled()
    })

    it('lista a rede inteira (sem filtro de polo), do mais novo para o mais antigo, em 300 por padrão', async () => {
      const { db, service } = make()
      withQueryResults(db, [])
      await service.listPlatform()
      expect(db.where).not.toHaveBeenCalled()
      expect(db.orderBy).toHaveBeenCalledTimes(1)
      expect(renderSql(db.orderBy.mock.calls[0][0]).sql).toBe('`audit_logs`.`created_at` desc')
      expect(db.limit).toHaveBeenCalledWith(300)
    })

    it('respeita o limite pedido', async () => {
      const { db, service } = make()
      withQueryResults(db, [])
      await service.listPlatform(50)
      expect(db.limit).toHaveBeenCalledWith(50)
    })

    it('registro sem data de criação vem com texto vazio', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ log: registro({ createdAt: null }), tenantName: 'Polo A' }])
      expect((await service.listPlatform())[0].createdAt).toBe('')
    })
  })
})
