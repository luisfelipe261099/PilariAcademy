import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common'
import { Role } from '@pilari/types'
import type { Announcement } from '@pilari/types'
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { Authenticated } from '../../common/decorators/authenticated.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { DecodedFirebaseUser } from '../../common/types/user.type'
import { actorOf } from '../../common/types/actor.type'
import { CurrentTenant } from '../tenancy/current-tenant.decorator'
import type { TenantContext } from '../tenancy/tenant-context'
import { AnnouncementsService } from './announcements.service'
import { CreateAnnouncementDto } from './dto/engagement.dto'

@Controller('me')
@UseGuards(FirebaseAuthGuard)
@Authenticated()
export class StudentAnnouncementsController {
  constructor(private readonly ann: AnnouncementsService) {}

  @Get('courses/:slug/announcements')
  async list(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('slug') slug: string): Promise<{ announcements: Announcement[] }> {
    return { announcements: await this.ann.listForStudent(tenant.id, u.uid, slug) }
  }
}

@Controller('instructor')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.teacher, Role.admin)
export class InstructorAnnouncementsController {
  constructor(private readonly ann: AnnouncementsService) {}

  @Get('courses/:courseId/announcements')
  async list(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('courseId') courseId: string): Promise<{ announcements: Announcement[] }> {
    return { announcements: await this.ann.listForInstructor(actorOf(u, tenant), courseId) }
  }

  @Post('courses/:courseId/announcements')
  async create(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('courseId') courseId: string, @Body() dto: CreateAnnouncementDto): Promise<{ announcement: Announcement }> {
    return { announcement: await this.ann.create(actorOf(u, tenant), courseId, dto.title, dto.body) }
  }

  @Delete('announcements/:id')
  async remove(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('id') id: string): Promise<{ ok: true }> {
    await this.ann.remove(actorOf(u, tenant), id)
    return { ok: true }
  }
}
