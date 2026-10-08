/// <reference types="jest" />
import type { Response } from 'express'
import type { DecodedFirebaseUser } from '../../common/types/user.type'
import type { TenantContext } from '../tenancy/tenant-context'
import { AdminBillingController } from './admin-billing.controller'
import type { CreateChargeDto } from './dto/create-charge.dto'

// Na etapa 1 só a matriz passa pelo PanelSalesEnabledGuard, então a suíte de integração nunca vê outro polo nestas rotas
// (o polo do endereço é sempre a matriz). Por isso o teste usa um polo que NÃO é a matriz: prova que o controller leva
// o polo da requisição até o serviço — que é quem emite e cancela boleto de verdade no Asaas — em vez de fixar um.
const TENANT = { id: 't-x', isMatriz: false, status: 'active' } as TenantContext
const ADMIN = { uid: 'adm', email: 'adm@x.com' } as DecodedFirebaseUser

function make() {
  const billing = {
    searchStudents: jest.fn(async () => []),
    financeOf: jest.fn(async () => ({ student: { uid: 'u1', name: 'Maria', email: 'maria@x.com', cpf: null }, orders: [], totalPendingInCents: 0, totalPaidInCents: 0 })),
    createCharge: jest.fn(async () => ({ orderId: 'o1', paymentUrl: 'https://asaas/o1' })),
    cancelCharge: jest.fn(async () => ({ jaEstavaCancelado: false })),
    boletoFor: jest.fn(async () => Buffer.from('%PDF-carne')),
  }
  const audit = { log: jest.fn(async () => undefined) }
  return { controller: new AdminBillingController(billing as never, audit as never), billing, audit }
}

describe('AdminBillingController: o polo da requisição', () => {
  it('a busca de alunos é do polo do endereço', async () => {
    const { controller, billing } = make()
    await controller.students(TENANT, 'maria')
    expect(billing.searchStudents).toHaveBeenCalledWith('t-x', 'maria')
  })

  it('sem termo de busca, procura por texto vazio (o serviço devolve lista vazia)', async () => {
    const { controller, billing } = make()
    await controller.students(TENANT, undefined)
    expect(billing.searchStudents).toHaveBeenCalledWith('t-x', '')
  })

  it('a ficha do aluno é lida no polo do endereço', async () => {
    const { controller, billing } = make()
    await controller.finance(TENANT, 'u1')
    expect(billing.financeOf).toHaveBeenCalledWith('t-x', 'u1')
  })

  it('a cobrança é criada no polo do endereço e auditada nele', async () => {
    const { controller, billing, audit } = make()
    const dto = { userId: 'u1', description: 'Taxa de segunda via', amountInCents: 5000, installmentCount: 1 } as CreateChargeDto
    const r = await controller.create(ADMIN, TENANT, dto)
    expect(r).toEqual({ orderId: 'o1', paymentUrl: 'https://asaas/o1' })
    expect(billing.createCharge).toHaveBeenCalledWith('t-x', 'adm', expect.objectContaining({ userId: 'u1', amountInCents: 5000, installmentCount: 1 }))
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-x', actorUid: 'adm', action: 'billing.charge.create', targetId: 'o1' }))
  })

  it('o cancelamento é do pedido do polo do endereço e auditado nele', async () => {
    const { controller, billing, audit } = make()
    const r = await controller.cancel(ADMIN, TENANT, 'o1')
    expect(r).toEqual({ jaEstavaCancelado: false })
    expect(billing.cancelCharge).toHaveBeenCalledWith('t-x', 'o1')
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-x', action: 'billing.charge.cancel', targetId: 'o1' }))
  })

  it('o carnê em PDF é do pedido do polo do endereço', async () => {
    const { controller, billing } = make()
    const res = { set: jest.fn(), send: jest.fn() }
    await controller.carne(TENANT, 'o1', res as unknown as Response)
    expect(billing.boletoFor).toHaveBeenCalledWith('t-x', 'o1')
    expect(res.set).toHaveBeenCalledWith(expect.objectContaining({ 'Content-Type': 'application/pdf' }))
    expect(res.send).toHaveBeenCalledWith(Buffer.from('%PDF-carne'))
  })
})
