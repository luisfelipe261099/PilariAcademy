import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common'
import type { LessonNote } from '@pilari/types'
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard'
import { Authenticated } from '../../common/decorators/authenticated.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { DecodedFirebaseUser } from '../../common/types/user.type'
import { CurrentTenant } from '../tenancy/current-tenant.decorator'
import type { TenantContext } from '../tenancy/tenant-context'
import { NotesService } from './notes.service'
import { CreateNoteDto } from './dto/engagement.dto'

@Controller('me')
@UseGuards(FirebaseAuthGuard)
@Authenticated()
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get('courses/:slug/notes')
  async list(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('slug') slug: string): Promise<{ notes: LessonNote[] }> {
    return { notes: await this.notes.listForCourse(tenant.id, u.uid, slug) }
  }

  @Post('lessons/:lessonId/notes')
  async create(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('lessonId') lessonId: string, @Body() dto: CreateNoteDto): Promise<{ note: LessonNote }> {
    return { note: await this.notes.create(tenant.id, u.uid, lessonId, dto.atSec, dto.body) }
  }

  @Delete('notes/:id')
  async remove(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('id') id: string): Promise<{ ok: true }> {
    await this.notes.remove(tenant.id, u.uid, id)
    return { ok: true }
  }
}
