import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common'
import { Role } from '@pilari/types'
import type { AdminCourseRow, AdminStats, AuditLog } from '@pilari/types'
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { DecodedFirebaseUser } from '../../common/types/user.type'
import { AdminService } from './admin.service'
import { AuditService } from '../audit/audit.service'
import { CurrentTenant } from '../tenancy/current-tenant.decorator'
import type { TenantContext } from '../tenancy/tenant-context'
import { SetOwnerDto } from './dto/set-owner.dto'

@Controller('admin')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.admin)
export class AdminDashboardController {
  constructor(
    private readonly admin: AdminService,
    private readonly audit: AuditService
  ) {}

  @Get('stats')
  async stats(@CurrentTenant() tenant: TenantContext): Promise<AdminStats> {
    return this.admin.stats(tenant.id)
  }

  @Get('courses')
  async courses(@CurrentTenant() tenant: TenantContext): Promise<{ courses: AdminCourseRow[] }> {
    return { courses: await this.admin.listAllCourses(tenant.id) }
  }

  @Patch('courses/:id/owner')
  async setOwner(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: SetOwnerDto) {
    const r = await this.admin.setCourseOwner(tenant.id, id, dto.instructorId)
    this.audit.log({ tenantId: tenant.id, actorUid: u.uid, actorEmail: u.email, action: 'course.owner', summary: `Curso ${id} vinculado a ${r.instructorName ?? r.instructorId}`, targetType: 'course', targetId: id })
    return r
  }

  @Get('logs')
  async logs(@CurrentTenant() tenant: TenantContext): Promise<{ logs: AuditLog[] }> {
    return { logs: await this.audit.list(tenant.id, 150) }
  }
}
