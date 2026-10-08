import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import type { PlatformAuditLog, PlatformCourseRow, ReviewQueueItem } from '@pilari/types'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { PlatformAdmin } from '../../common/decorators/platform-admin.decorator'
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import type { DecodedFirebaseUser } from '../../common/types/user.type'
import { AuditService } from '../audit/audit.service'
import { ApproveCourseDto, ReviewNoteDto } from './dto/platform.dto'
import { PlatformReviewService, type ReviewedCourse } from './platform-review.service'
import { auditNote } from './review-rules'

/** Aprovação e logs da rede. O log de cada decisão vai para o polo do curso. */
@Controller('platform')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@PlatformAdmin()
export class PlatformReviewController {
  constructor(
    private readonly review: PlatformReviewService,
    private readonly audit: AuditService
  ) {}

  @Get('review-queue')
  async queue(): Promise<{ items: ReviewQueueItem[] }> {
    return { items: await this.review.queue() }
  }

  /** Cursos de todos os polos (busca por título em `q`), para a tela de modelos de certificado vincular curso de qualquer polo. */
  @Get('courses')
  async courses(@Query('q') q?: string): Promise<{ courses: PlatformCourseRow[] }> {
    return { courses: await this.review.listCourses(q) }
  }

  /** Aprova a versão do curso que a fila mostrou: o corpo traz o `fingerprint` dela (409 `COURSE_CHANGED` se mudou). */
  @Post('courses/:id/approve')
  async approve(@CurrentUser() u: DecodedFirebaseUser, @Param('id') id: string, @Body() dto: ApproveCourseDto): Promise<ReviewedCourse> {
    const c = await this.review.approve(u.uid, id, dto.fingerprint)
    this.audit.log({ tenantId: c.tenantId, actorUid: u.uid, actorEmail: u.email, action: 'course.approve', summary: `Studio Pilari aprovou o curso "${c.title}"`, targetType: 'course', targetId: c.id })
    return c
  }

  @Post('courses/:id/return')
  async returnToDraft(@CurrentUser() u: DecodedFirebaseUser, @Param('id') id: string, @Body() dto: ReviewNoteDto): Promise<ReviewedCourse> {
    const c = await this.review.returnToDraft(id, dto.note)
    this.audit.log({ tenantId: c.tenantId, actorUid: u.uid, actorEmail: u.email, action: 'course.return', summary: `Studio Pilari devolveu o curso "${c.title}" para ajustes: ${auditNote(dto.note)}`, targetType: 'course', targetId: c.id })
    return c
  }

  @Post('courses/:id/takedown')
  async takedown(@CurrentUser() u: DecodedFirebaseUser, @Param('id') id: string, @Body() dto: ReviewNoteDto): Promise<ReviewedCourse> {
    const c = await this.review.takedown(id, dto.note)
    this.audit.log({ tenantId: c.tenantId, actorUid: u.uid, actorEmail: u.email, action: 'course.takedown', summary: `Studio Pilari tirou do ar o curso "${c.title}": ${auditNote(dto.note)}`, targetType: 'course', targetId: c.id })
    return c
  }

  @Get('logs')
  async logs(): Promise<{ logs: PlatformAuditLog[] }> {
    return { logs: await this.audit.listPlatform(300) }
  }
}
