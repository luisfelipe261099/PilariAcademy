import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common'
import type { Classroom } from '@pilari/types'
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard'
import { Authenticated } from '../../common/decorators/authenticated.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { DecodedFirebaseUser } from '../../common/types/user.type'
import { CurrentTenant } from '../tenancy/current-tenant.decorator'
import type { TenantContext } from '../tenancy/tenant-context'
import { ClassroomService } from './classroom.service'
import { ProgressService } from './progress.service'
import { SetProgressDto } from './dto/set-progress.dto'

@Controller('me')
@UseGuards(FirebaseAuthGuard)
@Authenticated()
export class ClassroomController {
  constructor(
    private readonly classroomService: ClassroomService,
    private readonly progressService: ProgressService
  ) {}

  @Get('courses/:slug/classroom')
  async classroom(@CurrentUser() user: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('slug') slug: string): Promise<Classroom> {
    return this.classroomService.getClassroom(tenant, user.uid, slug)
  }

  @Put('lessons/:lessonId/progress')
  async setProgress(
    @CurrentUser() user: DecodedFirebaseUser,
    @CurrentTenant() tenant: TenantContext,
    @Param('lessonId') lessonId: string,
    @Body() dto: SetProgressDto
  ): Promise<{ completed: boolean }> {
    return this.progressService.setProgress(tenant.id, user.uid, lessonId, dto.completed)
  }
}
