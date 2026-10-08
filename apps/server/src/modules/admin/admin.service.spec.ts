/// <reference types="jest" />
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { and, eq, inArray } from 'drizzle-orm'
import { createDrizzleMock, withQueryResults, type DrizzleMock } from '../../__test-utils__/drizzle-mock'
import { allWheres } from '../../__test-utils__/sql'
import { orderInstallments } from '../../db/schema'
import { CourseScopeService } from '../tenancy/course-scope.service'
import { TenantMembersService } from '../tenancy/tenant-members.service'
import { AdminService } from './admin.service'

function make() {
  const db: DrizzleMock = createDrizzleMock()
  return { db, service: new AdminService(db as never, new TenantMembersService(db as never), new CourseScopeService(db as never)) }
}

describe('AdminService', () => {
  it('stats conta papéis, cursos e pedidos pagos', async () => {
    const { db, service } = make()
    withQueryResults(
      db,
      [{ roles: ['student'] }, { roles: ['teacher'] }, { roles: ['student', 'admin'] }], // membros do polo
      [{ status: 'published' }, { status: 'draft' }], // courses
      [{ status: 'paid', total: 10000 }, { status: 'pending', total: 5000 }] // orders
    )
    const s = await service.stats('t-a')
    expect(s.studentCount).toBe(2)
    expect(s.teacherCount).toBe(1)
    expect(s.courseCount).toBe(2)
    expect(s.publishedCourseCount).toBe(1)
    expect(s.paidOrderCount).toBe(1)
    expect(s.grossInCents).toBe(10000)
  })

  it('stats conta membros, cursos e pedidos só do polo', async () => {
    const { db, service } = make()
    withQueryResults(db, [{ roles: ['student'] }, { roles: ['teacher'] }], [{ status: 'published' }], [])
    const s = await service.stats('t-a')
    expect(s).toMatchObject({ studentCount: 1, teacherCount: 1, courseCount: 1, publishedCourseCount: 1, paidOrderCount: 0 })
    const [m, c, o] = allWheres(db.where)
    expect(m.sql).toContain('`tenant_members`.`tenant_id` = ?')
    expect(c.sql).toContain('`courses`.`tenant_id` = ?')
    expect(o.sql).toContain('`orders`.`tenant_id` = ?')
  })

  it('stats filtra as três consultas pelo polo e prende a soma do carnê aos pedidos já filtrados', async () => {
    // O mock devolve a linha enfileirada qualquer que seja o WHERE: só o SQL e os parâmetros
    // provam que o polo chega às três consultas, e que a soma das parcelas (que não tem coluna
    // de polo) fica presa aos pedidos que já vieram filtrados.
    const { db, service } = make()
    withQueryResults(
      db,
      [{ roles: ['student'] }],
      [{ status: 'published' }],
      [{ id: 'ord_1', status: 'paid', total: 500000, asaasInstallmentId: 'inst_1' }],
      [{ soma: '100000' }]
    )
    await service.stats('t-a')
    const wheres = allWheres(db.where)
    expect(wheres).toHaveLength(4)
    expect(wheres[0]).toEqual({ sql: '`tenant_members`.`tenant_id` = ?', params: ['t-a'] })
    expect(wheres[1]).toEqual({ sql: '`courses`.`tenant_id` = ?', params: ['t-a'] })
    expect(wheres[2]).toEqual({ sql: '`orders`.`tenant_id` = ?', params: ['t-a'] })
    expect(wheres[3].params).toEqual(['ord_1', 'paid'])
  })

  it('grossInCents de um carnê conta só o que as parcelas PAID já trouxeram, não o total do pedido', async () => {
    // Um carnê de R$ 5.000 com 1 parcela de R$ 1.000 paga não pode virar R$ 5.000 de
    // "Receita" no painel do dono — o dinheiro ainda não chegou.
    const { db, service } = make()
    withQueryResults(
      db,
      [], // membros do polo
      [], // courses
      [{ id: 'ord_1', status: 'paid', total: 500000, asaasInstallmentId: 'inst_1' }], // orders: carnê pago (1a parcela liberou o acesso)
      [{ soma: '100000' }] // order_installments: soma das parcelas PAID desse carnê
    )
    const s = await service.stats('t-a')
    expect(s.grossInCents).toBe(100000)
    expect(s.paidOrderCount).toBe(1) // acesso liberado é métrica de vendas, não de dinheiro
    // Prova direta do filtro `status = 'paid'` na query: o mock devolve a linha enfileirada
    // (`{ soma: '100000' }`) INDEPENDENTE do WHERE, então apagar esse `eq` deixaria os 3
    // testes de receita verdes mesmo assim — essa é a única linha que separa dinheiro
    // RECEBIDO de dinheiro apenas FATURADO.
    expect(db.where).toHaveBeenCalledWith(and(inArray(orderInstallments.orderId, ['ord_1']), eq(orderInstallments.status, 'paid')))
  })

  it('grossInCents combina à-vista integral + parcelas pagas de carnês, ignorando pedidos pending', async () => {
    const { db, service } = make()
    withQueryResults(
      db,
      [], // membros do polo
      [], // courses
      [
        { id: 'ord_1', status: 'paid', total: 30000, asaasInstallmentId: null }, // à vista: R$ 300 cheios
        { id: 'ord_2', status: 'paid', total: 500000, asaasInstallmentId: 'inst_1' }, // carnê R$ 5.000, 2 parcelas pagas
        { id: 'ord_3', status: 'pending', total: 99999, asaasInstallmentId: null }, // não conta em nada
      ],
      [{ soma: '200000' }] // 2 parcelas de R$ 1.000 pagas do carnê ord_2
    )
    const s = await service.stats('t-a')
    expect(s.grossInCents).toBe(230000) // 30000 (à vista) + 200000 (parcelas pagas do carnê)
    expect(s.paidOrderCount).toBe(2) // ord_1 e ord_2 têm acesso liberado; ord_3 não
  })

  it('grossInCents não consulta order_installments quando não há carnê pago (evita query à toa)', async () => {
    const { db, service } = make()
    withQueryResults(
      db,
      [],
      [],
      [{ id: 'ord_1', status: 'paid', total: 10000, asaasInstallmentId: null }]
    )
    const s = await service.stats('t-a')
    expect(s.grossInCents).toBe(10000)
    // prova direta (não só o valor final): a tabela de parcelas nunca foi consultada
    expect(db.from.mock.calls.some((c) => c[0] === orderInstallments)).toBe(false)
  })

  it('listAllCourses mapeia com instrutor', async () => {
    const { db, service } = make()
    withQueryResults(db, [
      { course: { id: 'c1', title: 'Curso', slug: 's', status: 'draft', kind: 'online', priceInCents: 9700, commissionPercent: 30, instructorId: 'i1' }, instructorName: 'Prof' },
    ])
    const list = await service.listAllCourses('t-a')
    expect(list[0]).toEqual({ id: 'c1', title: 'Curso', slug: 's', status: 'draft', kind: 'online', priceInCents: 9700, commissionPercent: 30, instructorId: 'i1', instructorName: 'Prof', certificateTemplateId: null, approvedAt: null, reviewNote: null })
  })

  it('listAllCourses lista só os cursos do polo', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    await service.listAllCourses('t-a')
    expect(allWheres(db.where)).toEqual([{ sql: '`courses`.`tenant_id` = ?', params: ['t-a'] }])
  })

  it('listAllCourses traz a primeira aprovação em ISO e a nota do Studio Pilari', async () => {
    const { db, service } = make()
    const base = { title: 'Curso', slug: 's', status: 'draft', kind: 'online', priceInCents: 9700, commissionPercent: 30, instructorId: 'i1' }
    withQueryResults(db, [
      { course: { ...base, id: 'c1', approvedAt: new Date('2026-09-01T12:00:00.000Z'), reviewNote: 'Revisar a ementa.' }, instructorName: 'Prof' },
      { course: { ...base, id: 'c2', approvedAt: null, reviewNote: null }, instructorName: null },
    ])
    const list = await service.listAllCourses('t-a')
    expect(list[0]).toMatchObject({ id: 'c1', approvedAt: '2026-09-01T12:00:00.000Z', reviewNote: 'Revisar a ementa.' })
    expect(list[1]).toMatchObject({ id: 'c2', approvedAt: null, reviewNote: null })
  })

  it('setCourseOwner vincula quando o usuário é professor do polo', async () => {
    const { db, service } = make()
    withQueryResults(
      db,
      [{ roles: ['teacher'] }], // vínculo do dono candidato com o polo
      [{ id: 'c1' }], // o curso é do polo
      [{ name: 'Prof A' }], // nome do dono
      undefined // update
    )
    const r = await service.setCourseOwner('t-a', 'c1', 'i1')
    expect(r).toEqual({ instructorId: 'i1', instructorName: 'Prof A' })
    expect(db.set).toHaveBeenCalledWith({ instructorId: 'i1', updatedAt: expect.any(Date) })
    // O mock devolve a fila qualquer que seja o WHERE: só o SQL prova que o vínculo, o curso e o
    // UPDATE são todos do polo (o UPDATE repete o filtro de propósito, para nunca gravar fora).
    const [vinculo, curso, , update] = allWheres(db.where)
    expect(vinculo).toEqual({ sql: '(`tenant_members`.`tenant_id` = ? and `tenant_members`.`user_uid` = ?)', params: ['t-a', 'i1'] })
    expect(curso).toEqual({ sql: '(`courses`.`tenant_id` = ? and `courses`.`id` = ?)', params: ['t-a', 'c1'] })
    expect(update).toEqual({ sql: '(`courses`.`id` = ? and `courses`.`tenant_id` = ?)', params: ['c1', 't-a'] })
  })

  it('setCourseOwner aceita um admin do polo como dono', async () => {
    const { db, service } = make()
    withQueryResults(db, [{ roles: ['admin'] }], [{ id: 'c1' }], [{ name: 'Admin A' }], undefined)
    await expect(service.setCourseOwner('t-a', 'c1', 'adm')).resolves.toEqual({ instructorId: 'adm', instructorName: 'Admin A' })
    expect(db.update).toHaveBeenCalled()
  })

  it('dono do curso precisa ser professor ou admin do polo', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    await expect(service.setCourseOwner('t-a', 'c1', 'u-de-outro-polo')).rejects.toThrow('Usuário não encontrado neste polo.')
    withQueryResults(db, [{ roles: ['student'] }])
    await expect(service.setCourseOwner('t-a', 'c1', 'u-aluno')).rejects.toThrow('O dono precisa ser professor ou admin deste polo.')
  })

  it('setCourseOwner: dono sem vínculo com o polo é 404, e nem o curso é consultado nem nada é gravado', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    await expect(service.setCourseOwner('t-a', 'c1', 'u-de-outro-polo')).rejects.toBeInstanceOf(NotFoundException)
    expect(db.select).toHaveBeenCalledTimes(1) // só o vínculo
    expect(allWheres(db.where)).toEqual([{ sql: '(`tenant_members`.`tenant_id` = ? and `tenant_members`.`user_uid` = ?)', params: ['t-a', 'u-de-outro-polo'] }])
    expect(db.update).not.toHaveBeenCalled()
  })

  it('setCourseOwner: dono que é só aluno do polo é 400, e nem o curso é consultado nem nada é gravado', async () => {
    const { db, service } = make()
    withQueryResults(db, [{ roles: ['student'] }])
    await expect(service.setCourseOwner('t-a', 'c1', 'u-aluno')).rejects.toBeInstanceOf(BadRequestException)
    expect(db.select).toHaveBeenCalledTimes(1)
    expect(db.update).not.toHaveBeenCalled()
  })

  it('setCourseOwner: curso de outro polo é 404 e nada é gravado', async () => {
    const { db, service } = make()
    withQueryResults(db, [{ roles: ['teacher'] }], []) // o dono é do polo, o curso não
    const pedido = service.setCourseOwner('t-a', 'c-do-b', 'i1')
    await expect(pedido).rejects.toBeInstanceOf(NotFoundException)
    await expect(pedido).rejects.toThrow('Curso não encontrado.')
    // O mock devolve [] de qualquer jeito: o que prova que o curso é buscado DENTRO do polo é o SQL.
    expect(allWheres(db.where)[1]).toEqual({ sql: '(`courses`.`tenant_id` = ? and `courses`.`id` = ?)', params: ['t-a', 'c-do-b'] })
    expect(db.update).not.toHaveBeenCalled()
  })

  // ── Matrícula manual por polo ───────────────────────────────────────────────

  it('listUserEnrollments lista só as matrículas dos cursos do polo', async () => {
    const { db, service } = make()
    withQueryResults(db, [
      { courseId: 'c1', status: 'active', source: 'free', title: 'Excel do Polo A', slug: 'excel-basico' },
      { courseId: 'c2', status: 'canceled', source: 'purchase', title: 'Word', slug: 'word' },
    ])
    const r = await service.listUserEnrollments('t-a', 'u1')
    expect(r).toEqual([
      { courseId: 'c1', courseTitle: 'Excel do Polo A', courseSlug: 'excel-basico', status: 'active', source: 'free' },
      { courseId: 'c2', courseTitle: 'Word', courseSlug: 'word', status: 'canceled', source: 'purchase' },
    ])
    // O mock devolve a fila qualquer que seja o WHERE: só o SQL prova que o aluno que estuda em
    // dois polos não mostra, na tela de um, as matrículas do outro.
    expect(allWheres(db.where)).toEqual([{ sql: '(`enrollments`.`user_id` = ? and `courses`.`tenant_id` = ?)', params: ['u1', 't-a'] }])
  })

  it('grantEnrollment cria matrícula ativa (source free) quando não existe, e o vínculo de aluno do polo', async () => {
    const { db, service } = make()
    withQueryResults(
      db,
      [{ uid: 'u1' }], // usuário existe
      [{ id: 'c1', title: 'Curso', slug: 's' }], // o curso é do polo
      [] // nenhuma matrícula prévia
    )
    const r = await service.grantEnrollment('t-a', 'u1', 'c1')
    expect(r).toEqual({ courseId: 'c1', courseTitle: 'Curso', courseSlug: 's', status: 'active', source: 'free' })
    expect(db.insert).toHaveBeenCalledTimes(2) // a matrícula e o vínculo
    const [matricula, vinculo] = db.values.mock.calls.map((c) => c[0])
    expect(matricula).toMatchObject({ userId: 'u1', courseId: 'c1', status: 'active', source: 'free' })
    expect(vinculo).toMatchObject({ tenantId: 't-a', userUid: 'u1', roles: ['student'] })
  })

  it('grantEnrollment busca o curso DENTRO do polo', async () => {
    const { db, service } = make()
    withQueryResults(db, [{ uid: 'u1' }], [{ id: 'c1', title: 'Curso', slug: 's' }], [])
    await service.grantEnrollment('t-a', 'u1', 'c1')
    expect(allWheres(db.where)[1]).toEqual({ sql: '(`courses`.`tenant_id` = ? and `courses`.`id` = ?)', params: ['t-a', 'c1'] })
  })

  it('grantEnrollment: curso de outro polo é 404 e nada é gravado, nem matrícula nem vínculo', async () => {
    const { db, service } = make()
    withQueryResults(db, [{ uid: 'u1' }], []) // usuário ok, curso fora do polo
    const pedido = service.grantEnrollment('t-a', 'u1', 'c-do-b')
    await expect(pedido).rejects.toBeInstanceOf(NotFoundException)
    await expect(pedido).rejects.toThrow('Curso não encontrado.')
    // O mock devolve [] de qualquer jeito: o que prova que o curso é buscado DENTRO do polo é o SQL.
    expect(allWheres(db.where)[1]).toEqual({ sql: '(`courses`.`tenant_id` = ? and `courses`.`id` = ?)', params: ['t-a', 'c-do-b'] })
    expect(db.insert).not.toHaveBeenCalled()
    expect(db.update).not.toHaveBeenCalled()
  })

  it('grantEnrollment: usuário inexistente é 404 e nem o curso é consultado', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    const pedido = service.grantEnrollment('t-a', 'u-fantasma', 'c1')
    await expect(pedido).rejects.toBeInstanceOf(NotFoundException)
    await expect(pedido).rejects.toThrow('Usuário não encontrado.')
    expect(db.select).toHaveBeenCalledTimes(1)
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('grantEnrollment reativa matrícula cancelada em vez de duplicar, e garante o vínculo de aluno', async () => {
    const { db, service } = make()
    withQueryResults(
      db,
      [{ uid: 'u1' }],
      [{ id: 'c1', title: 'Curso', slug: 's' }],
      [{ id: 'e1', status: 'canceled' }] // já existe, cancelada
    )
    const r = await service.grantEnrollment('t-a', 'u1', 'c1')
    expect(r.status).toBe('active')
    expect(db.update).toHaveBeenCalled()
    expect(db.insert).toHaveBeenCalledTimes(1) // só o vínculo: a matrícula foi reativada, não duplicada
    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-a', userUid: 'u1', roles: ['student'] }))
  })

  it('grantEnrollment NÃO mexe no orderId ao reativar — admin-orders.service.ts e earnings.service.ts derivam os cursos do pedido a partir dele; zerar apagaria a lista de cursos do pedido no admin e o repasse do instrutor', async () => {
    const { db, service } = make()
    withQueryResults(
      db,
      [{ uid: 'u1' }],
      [{ id: 'c1', title: 'Curso', slug: 's' }],
      [{ id: 'e1', status: 'canceled' }] // matrícula cancelada, com orderId de uma compra velha
    )
    await service.grantEnrollment('t-a', 'u1', 'c1')
    // Igualdade exata (não objectContaining): garante que a chave orderId nem aparece no
    // patch — um órfão apontando pra um pedido velho é tolerado de propósito pelo gate do
    // certificado (certificate.service.ts), que basta em source === 'free'.
    expect(db.set).toHaveBeenCalledWith({ status: 'active', source: 'free', activatedAt: expect.any(Date), updatedAt: expect.any(Date) })
  })

  it('grantEnrollment rejeita quando o aluno já tem acesso ativo, sem gravar nada', async () => {
    const { db, service } = make()
    withQueryResults(
      db,
      [{ uid: 'u1' }],
      [{ id: 'c1', title: 'Curso', slug: 's' }],
      [{ id: 'e1', status: 'active' }]
    )
    await expect(service.grantEnrollment('t-a', 'u1', 'c1')).rejects.toBeInstanceOf(BadRequestException)
    expect(db.insert).not.toHaveBeenCalled()
    expect(db.update).not.toHaveBeenCalled()
  })

  it('revokeEnrollment apaga a matrícula de um curso do polo', async () => {
    const { db, service } = make()
    withQueryResults(db, [{ id: 'c1' }]) // o curso é do polo
    const r = await service.revokeEnrollment('t-a', 'u1', 'c1')
    expect(r).toEqual({ ok: true })
    expect(db.delete).toHaveBeenCalled()
    const [curso, apagar] = allWheres(db.where)
    expect(curso).toEqual({ sql: '(`courses`.`tenant_id` = ? and `courses`.`id` = ?)', params: ['t-a', 'c1'] })
    expect(apagar).toEqual({ sql: '(`enrollments`.`user_id` = ? and `enrollments`.`course_id` = ?)', params: ['u1', 'c1'] })
  })

  it('revokeEnrollment: curso de outro polo é 404 e nenhuma matrícula é apagada', async () => {
    const { db, service } = make()
    withQueryResults(db, []) // o curso não é do polo
    await expect(service.revokeEnrollment('t-a', 'u1', 'c-do-b')).rejects.toBeInstanceOf(NotFoundException)
    expect(db.delete).not.toHaveBeenCalled()
  })
})

describe('AdminService: rótulos do log de cortesia', () => {
  it('pessoa: nome do cadastro, senão e-mail, senão uid', async () => {
    const { db, service } = make()
    withQueryResults(db, [{ displayName: ' Ana Lima ', email: 'ana@x.test' }])
    expect(await service.personLabel('u1')).toBe('Ana Lima')
    withQueryResults(db, [{ displayName: null, email: 'ana@x.test' }])
    expect(await service.personLabel('u1')).toBe('ana@x.test')
    withQueryResults(db, [])
    expect(await service.personLabel('u-sem-linha')).toBe('u-sem-linha')
  })
})
