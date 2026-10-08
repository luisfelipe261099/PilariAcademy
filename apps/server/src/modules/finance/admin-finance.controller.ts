import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { Role } from '@pilari/types'
import type { AdminFinance, PayoutRecord } from '@pilari/types'
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { DecodedFirebaseUser } from '../../common/types/user.type'
import { FinanceService } from './finance.service'
import { AuditService } from '../audit/audit.service'
import { CurrentTenant } from '../tenancy/current-tenant.decorator'
import type { TenantContext } from '../tenancy/tenant-context'
import { RegisterPayoutDto, SetCommissionDto } from './dto/finance.dto'

@Controller('admin')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.admin)
export class AdminFinanceController {
  constructor(
    private readonly finance: FinanceService,
    private readonly audit: AuditService
  ) {}

  @Get('finance')
  async summary(@CurrentTenant() tenant: TenantContext, @Query('month') month?: string): Promise<AdminFinance> {
    return this.finance.adminSummary(tenant.id, month)
  }

  @Post('payouts')
  async registerPayout(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Body() dto: RegisterPayoutDto): Promise<{ payout: PayoutRecord }> {
    const payout = await this.finance.registerPayout(tenant.id, dto.instructorId, dto.amountInCents, dto.note)
    this.audit.log({ tenantId: tenant.id, actorUid: u.uid, actorEmail: u.email, action: 'payout.register', summary: `Repasse de ${(dto.amountInCents / 100).toFixed(2)} ao instrutor ${dto.instructorId}`, targetType: 'instructor', targetId: dto.instructorId })
    return { payout }
  }

  @Patch('courses/:id/commission')
  async setCommission(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: SetCommissionDto) {
    const r = await this.finance.setCommission(tenant.id, id, dto.commissionPercent)
    this.audit.log({ tenantId: tenant.id, actorUid: u.uid, actorEmail: u.email, action: 'course.commission', summary: `Comissão do curso ${id} = ${dto.commissionPercent}%`, targetType: 'course', targetId: id })
    return r
  }
}
