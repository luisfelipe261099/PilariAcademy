import { Controller, Post, UseGuards } from '@nestjs/common'
import type { AsaasReconcileResult } from '@pilari/types'
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { PlatformAdmin } from '../../common/decorators/platform-admin.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { DecodedFirebaseUser } from '../../common/types/user.type'
import { WebhookService } from './webhook.service'
import { AuditService } from '../audit/audit.service'

/**
 * Reconciliação manual: puxa o status do Asaas p/ liberar boletos pagos que ficaram pending. É da PLATAFORMA:
 * a conta Asaas ainda é única (até a etapa 2) e a varredura cobre os pedidos de todos os polos.
 */
@Controller('admin')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@PlatformAdmin()
export class AdminReconcileController {
  constructor(
    private readonly webhook: WebhookService,
    private readonly audit: AuditService
  ) {}

  @Post('reconcile-asaas')
  async reconcile(@CurrentUser() u: DecodedFirebaseUser): Promise<AsaasReconcileResult> {
    const result = await this.webhook.reconcilePending()
    this.audit.log({
      // A conta Asaas ainda é única: a conciliação é da plataforma, nunca de um polo.
      tenantId: null,
      actorUid: u.uid,
      actorEmail: u.email,
      action: 'asaas.reconcile',
      // `checked` agora soma pendentes + carnês em aberto — "consultados", não só "pendentes".
      summary: `Reconcile Asaas: ${result.reconciled} liberados, ${result.installmentsReconciled ?? 0} parcelas de carnê conciliadas, de ${result.checked} consultados (${result.failed} falhas)`,
      targetType: 'order',
      targetId: null,
    })
    return result
  }
}
