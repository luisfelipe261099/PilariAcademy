/// <reference types="jest" />
import { NotFoundException } from '@nestjs/common'
import type { DecodedFirebaseUser } from '../../common/types/user.type'
import type { TenantContext } from '../tenancy/tenant-context'
import { AdminOrdersController } from './admin-orders.controller'

// Na etapa 1 só a matriz passa pelo PanelSalesEnabledGuard, então a suíte de integração nunca vê outro polo nestas rotas
// (o polo do endereço é sempre a matriz). Por isso o teste usa um polo que NÃO é a matriz: prova que o controller leva
// o polo da requisição até o serviço, em vez de fixar um, e que a checagem do pedido vem antes de qualquer ação.
const TENANT = { id: 't-x', isMatriz: false, status: 'active' } as TenantContext
const ADMIN = { uid: 'adm', email: 'adm@x.com' } as DecodedFirebaseUser

function make() {
  const ordem: string[] = []
  const adminOrders = {
    list: jest.fn(async () => []),
    assertInTenant: jest.fn(async () => {
      ordem.push('assertInTenant')
    }),
  }
  const webhook = {
    settleManually: jest.fn(async () => {
      ordem.push('settleManually')
      return { alreadyPaid: false }
    }),
    cancelManually: jest.fn(async () => {
      ordem.push('cancelManually')
      return { alreadyCanceled: false }
    }),
    settleCarneManually: jest.fn(async () => {
      ordem.push('settleCarneManually')
      return { alreadySettled: false }
    }),
  }
  const audit = { log: jest.fn() }
  const controller = new AdminOrdersController(adminOrders as never, webhook as never, audit as never)
  return { controller, adminOrders, webhook, audit, ordem }
}

const ACOES = [
  ['settle', 'settleManually'],
  ['cancel', 'cancelManually'],
  ['settleCarne', 'settleCarneManually'],
] as const

describe('AdminOrdersController: o polo da requisição', () => {
  it('lista os pedidos do polo do endereço', async () => {
    const { controller, adminOrders } = make()
    await controller.list(TENANT)
    expect(adminOrders.list).toHaveBeenCalledWith('t-x')
  })

  it.each(ACOES)('%s: confere que o pedido é do polo ANTES de agir, e audita no polo', async (metodo, acao) => {
    const { controller, adminOrders, audit, ordem } = make()
    await controller[metodo](ADMIN, TENANT, 'o1')
    expect(adminOrders.assertInTenant).toHaveBeenCalledWith('t-x', 'o1')
    expect(ordem).toEqual(['assertInTenant', acao])
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-x', actorUid: 'adm', targetType: 'order', targetId: 'o1' }))
  })

  it.each(ACOES)('%s com pedido de outro polo: 404, a ação nem roda e nada é auditado', async (metodo, acao) => {
    const { controller, adminOrders, webhook, audit } = make()
    adminOrders.assertInTenant.mockRejectedValueOnce(new NotFoundException('Pedido não encontrado.'))
    await expect(controller[metodo](ADMIN, TENANT, 'o-do-b')).rejects.toBeInstanceOf(NotFoundException)
    expect(webhook[acao]).not.toHaveBeenCalled()
    expect(audit.log).not.toHaveBeenCalled()
  })
})
