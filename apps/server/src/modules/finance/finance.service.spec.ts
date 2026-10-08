/// <reference types="jest" />
import { NotFoundException } from '@nestjs/common'
import { createDrizzleMock, withQueryResults, type DrizzleMock } from '../../__test-utils__/drizzle-mock'
import { allWheres } from '../../__test-utils__/sql'
import { CourseScopeService } from '../tenancy/course-scope.service'
import { TenantMembersService } from '../tenancy/tenant-members.service'
import { FinanceService } from './finance.service'

function make() {
  const db: DrizzleMock = createDrizzleMock()
  return { db, service: new FinanceService(db as never, new TenantMembersService(db as never), new CourseScopeService(db as never)) }
}

/** Resultado do SELECT em tenant_members quando a pessoa é do polo. */
const membro = [{ roles: ['teacher'] }]

describe('FinanceService', () => {
  it('adminSummary agrega por instrutor, calcula a receber e o líquido do mês', async () => {
    const { db, service } = make()
    withQueryResults(
      db,
      [{ instructorId: 'i1', gross: '10000', fee: '1000', net: '7000' }], // earnings agg (all-time)
      [{ instructorId: 'i1', paid: '2000' }], // payouts agg
      [{ instructorId: 'i1', net: '3000' }], // earnings do mês
      [{ uid: 'i1', name: 'Prof A' }] // users
    )
    const s = await service.adminSummary('t-a', '2026-06')
    expect(s.grossInCents).toBe(10000)
    expect(s.asaasFeeInCents).toBe(1000)
    expect(s.commissionInCents).toBe(2000) // bruto 10000 − taxa 1000 − repasse 7000
    expect(s.month).toBe('2026-06')
    expect(s.monthNetInCents).toBe(3000)
    expect(s.instructors[0]).toEqual({ instructorId: 'i1', instructorName: 'Prof A', netInCents: 7000, paidInCents: 2000, owedInCents: 5000, monthNetInCents: 3000 })
  })

  it('o resumo financeiro soma só o polo', async () => {
    const { db, service } = make()
    withQueryResults(db, [], [], [], [])
    await service.adminSummary('t-a', '2026-09')
    const w = allWheres(db.where)
    expect(w[0].sql).toContain('`earnings`.`tenant_id` = ?')
    expect(w[1].sql).toContain('`payouts`.`tenant_id` = ?')
    // O recorte do mês e a lista de vendas também ficam dentro do polo.
    expect(w[2].sql).toContain('`earnings`.`tenant_id` = ?')
    expect(w[3].sql).toContain('`earnings`.`tenant_id` = ?')
    // Nenhuma das quatro consultas pode perder o polo: cada uma leva 't-a' entre os parâmetros.
    for (const cond of w) expect(cond.params).toContain('t-a')
    expect(w).toHaveLength(4)
  })

  it('listSales não duplica título de curso quando o carnê grava um earning por parcela', async () => {
    // Um carnê de 5x grava 1 linha em `earnings` por PARCELA de cada curso. Sem DISTINCT/dedupe
    // no join earnings×courses, uma venda de 1 curso em 3 parcelas pagas viraria
    // "Curso X, Curso X, Curso X" no FinanceManager.tsx (courseTitles.join(', ')).
    const { db, service } = make()
    withQueryResults(
      db,
      [], // earnings agg por instrutor (vazio — nenhum instrutor neste teste)
      [], // payouts agg
      [], // earnings do mês
      [{ orderId: 'ord_1', gross: '500000', fee: '5000', net: '400000' }], // listSales: earnings agg por pedido
      [{ id: 'ord_1', userId: 'u1', paidAt: new Date('2026-06-10') }], // orders
      [{ uid: 'u1', name: 'Aluno', email: 'a@x.com' }], // buyers
      [
        { orderId: 'ord_1', title: 'Curso X' },
        { orderId: 'ord_1', title: 'Curso X' },
        { orderId: 'ord_1', title: 'Curso X' },
      ] // titleRows: 3 parcelas pagas do MESMO curso
    )
    const s = await service.adminSummary('t-a', '2026-06')
    expect(s.sales[0].courseTitles).toEqual(['Curso X'])
    // aggregate monetário não muda: já vem certo com N linhas (soma via SQL agrupada por pedido)
    expect(s.sales[0].grossInCents).toBe(500000)
  })

  describe('instructorEarnings', () => {
    it('soma só os ganhos e os repasses do instrutor NO POLO, e lista só os repasses do polo', async () => {
      const { db, service } = make()
      const quando = new Date('2026-09-10T12:00:00.000Z')
      withQueryResults(
        db,
        [{ net: '1000' }], // earnings
        [{ paid: '400' }], // payouts agg
        [{ id: 'p1', amountInCents: 400, note: 'PIX', paidAt: quando }] // repasses
      )
      const r = await service.instructorEarnings('t-a', 'i1')
      expect(r).toEqual({
        netInCents: 1000,
        paidInCents: 400,
        owedInCents: 600,
        payouts: [{ id: 'p1', amountInCents: 400, note: 'PIX', paidAt: quando.toISOString() }],
      })
      const w = allWheres(db.where)
      expect(w).toEqual([
        { sql: '(`earnings`.`instructor_id` = ? and `earnings`.`tenant_id` = ?)', params: ['i1', 't-a'] },
        { sql: '(`payouts`.`instructor_id` = ? and `payouts`.`tenant_id` = ?)', params: ['i1', 't-a'] },
        { sql: '(`payouts`.`instructor_id` = ? and `payouts`.`tenant_id` = ?)', params: ['i1', 't-a'] },
      ])
    })

    it('sem ganhos nem repasses no polo, tudo zero', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ net: null }], [{ paid: null }], [])
      expect(await service.instructorEarnings('t-b', 'i1')).toEqual({ netInCents: 0, paidInCents: 0, owedInCents: 0, payouts: [] })
    })
  })

  describe('registerPayout', () => {
    it('insere o repasse no polo e retorna o registro', async () => {
      const { db, service } = make()
      withQueryResults(db, membro, undefined)
      const p = await service.registerPayout('t-a', 'i1', 5000, 'PIX')
      expect(p.amountInCents).toBe(5000)
      expect(p.note).toBe('PIX')
      expect(db.insert).toHaveBeenCalled()
      expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-a', instructorId: 'i1', amountInCents: 5000, note: 'PIX' }))
    })

    it('confere o vínculo no polo informado, não em qualquer polo', async () => {
      const { db, service } = make()
      withQueryResults(db, membro, undefined)
      await service.registerPayout('t-a', 'i1', 5000)
      expect(allWheres(db.where)[0].params).toEqual(['t-a', 'i1'])
    })

    it('repasse para quem não é do polo responde 404', async () => {
      const { db, service } = make()
      withQueryResults(db, [])
      const chamada = service.registerPayout('t-a', 'u-de-fora', 100)
      await expect(chamada).rejects.toThrow('Parceiro não encontrado neste polo.')
      await expect(chamada).rejects.toBeInstanceOf(NotFoundException)
    })

    it('repasse para quem não é do polo não grava nada', async () => {
      const { db, service } = make()
      withQueryResults(db, [])
      await expect(service.registerPayout('t-a', 'u-de-fora', 100)).rejects.toThrow()
      expect(db.insert).not.toHaveBeenCalled()
    })
  })

  describe('setCommission', () => {
    it('atualiza o curso, e só dentro do polo', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ id: 'c1', tenantId: 't-a' }], undefined)
      const r = await service.setCommission('t-a', 'c1', 40)
      expect(r.commissionPercent).toBe(40)
      expect(db.update).toHaveBeenCalled()
      expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ commissionPercent: 40 }))
      const w = allWheres(db.where)
      // 1ª: a checagem de escopo do curso; 2ª: o próprio UPDATE, que também carrega o polo.
      expect(w[0]).toEqual({ sql: '(`courses`.`tenant_id` = ? and `courses`.`id` = ?)', params: ['t-a', 'c1'] })
      expect(w[1]).toEqual({ sql: '(`courses`.`id` = ? and `courses`.`tenant_id` = ?)', params: ['c1', 't-a'] })
    })

    it('curso de outro polo responde 404 e não grava', async () => {
      const { db, service } = make()
      withQueryResults(db, [])
      await expect(service.setCommission('t-a', 'c-do-b', 30)).rejects.toThrow('Curso não encontrado.')
      expect(db.update).not.toHaveBeenCalled()
    })
  })
})
