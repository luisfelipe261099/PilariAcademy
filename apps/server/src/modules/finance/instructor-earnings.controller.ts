import { Controller, Get, UseGuards } from '@nestjs/common'
import { Role } from '@pilari/types'
import type { InstructorEarnings } from '@pilari/types'
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { DecodedFirebaseUser } from '../../common/types/user.type'
import { FinanceService } from './finance.service'
import { CurrentTenant } from '../tenancy/current-tenant.decorator'
import type { TenantContext } from '../tenancy/tenant-context'

@Controller('instructor')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.teacher, Role.admin)
export class InstructorEarningsController {
  constructor(private readonly finance: FinanceService) {}

  @Get('earnings')
  async earnings(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext): Promise<InstructorEarnings> {
    return this.finance.instructorEarnings(tenant.id, u.uid)
  }
}
