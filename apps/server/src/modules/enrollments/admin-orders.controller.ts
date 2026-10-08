import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { Role } from '@pilari/types'
import type { AdminOrderRow } from '@pilari/types'
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { DecodedFirebaseUser } from '../../common/types/user.type'
import { AdminOrdersService } from './admin-orders.service'
import { WebhookService } from './webhook.service'
import { AuditService } from '../audit/audit.service'
import { CurrentTenant } from '../tenancy/current-tenant.decorator'
import type { TenantContext } from '../tenancy/tenant-context'
import { PanelSalesEnabledGuard } from '../tenancy/storefront.guards'

/**
 * Cobranças (pedidos) no admin: listar, dar baixa manual e cancelar. Só em polo que vende, e só sobre os
 * pedidos do polo: o WebhookService age pelo id do pedido, então a checagem do polo vem antes de cada ação.
 */
@Controller('admin')
@UseGuards(FirebaseAuthGuard, RolesGuard, PanelSalesEnabledGuard)
@Roles(Role.admin)
export class AdminOrdersController {
  constructor(
    private readonly adminOrders: AdminOrdersService,
    private readonly webhook: WebhookService,
    private readonly audit: AuditService
  ) {}

  @Get('orders')
  async list(@CurrentTenant() tenant: TenantContext): Promise<{ orders: AdminOrderRow[] }> {
    return { orders: await this.adminOrders.list(tenant.id) }
  }

  /** Baixa manual: marca pago + libera acesso + captura ganho (idempotente). */
  @Post('orders/:id/settle')
  async settle(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('id') id: string): Promise<{ alreadyPaid: boolean }> {
    await this.adminOrders.assertInTenant(tenant.id, id)
    const r = await this.webhook.settleManually(id)
    this.audit.log({
      tenantId: tenant.id,
      actorUid: u.uid,
      actorEmail: u.email,
      action: 'order.settle_manual',
      summary: `Baixa manual do pedido ${id}${r.alreadyPaid ? ' (já estava pago)' : ''}`,
      targetType: 'order',
      targetId: id,
    })
    return r
  }

  @Post('orders/:id/cancel')
  async cancel(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('id') id: string): Promise<{ alreadyCanceled: boolean }> {
    await this.adminOrders.assertInTenant(tenant.id, id)
    const r = await this.webhook.cancelManually(id)
    this.audit.log({
      tenantId: tenant.id,
      actorUid: u.uid,
      actorEmail: u.email,
      action: 'order.cancel_manual',
      summary: `Cancelamento manual do pedido ${id}${r.alreadyCanceled ? ' (já estava cancelado)' : ''}`,
      targetType: 'order',
      targetId: id,
    })
    return r
  }

  /** Quitação manual de carnê: pedido já `paid` (acesso liberado), faltam parcelas — sem isto não há baixa possível. */
  @Post('orders/:id/settle-carne')
  async settleCarne(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('id') id: string): Promise<{ alreadySettled: boolean }> {
    await this.adminOrders.assertInTenant(tenant.id, id)
    const r = await this.webhook.settleCarneManually(id)
    this.audit.log({
      tenantId: tenant.id,
      actorUid: u.uid,
      actorEmail: u.email,
      action: 'order.settle_carne_manual',
      summary: `Quitação manual do carnê ${id}${r.alreadySettled ? ' (já estava quitado)' : ''}`,
      targetType: 'order',
      targetId: id,
    })
    return r
  }
}
