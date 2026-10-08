import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Put, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'
import { randomUUID } from 'node:crypto'
import { Role } from '@pilari/types'
import type { AuthoringModule, CourseStatus, InstructorCourse, UploadTicket } from '@pilari/types'
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { DecodedFirebaseUser } from '../../common/types/user.type'
import { actorOf } from '../../common/types/actor.type'
import { AuthoringService } from './authoring.service'
import { GcsService, MAX_IMAGE_BYTES } from '../classroom/gcs.service'
import { AuditService } from '../audit/audit.service'
import { CurrentTenant } from '../tenancy/current-tenant.decorator'
import type { TenantContext } from '../tenancy/tenant-context'
import { resolveImageResponse } from '../../common/lib/content-safety'
import {
  AddAttachmentDto, CreateCourseDto, ReorderDto, SetReleaseDto, SetStatusDto, TitleDto, UpdateCourseDto, UpdateLessonDto, UploadUrlDto,
} from './dto/authoring.dto'
import { auditCourseChange } from './course-change-log'

/**
 * Autoria por polo: quem age é o `Actor` (usuário + polo do endereço + admin DESTE polo). O
 * service resolve tudo pelo escopo do polo: id de outro polo responde 404, curso alheio no mesmo
 * polo responde 403 (salvo para o admin do polo).
 */
@Controller('instructor')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.teacher, Role.admin)
export class InstructorController {
  constructor(
    private readonly authoring: AuthoringService,
    private readonly gcs: GcsService,
    private readonly audit: AuditService
  ) {}

  // cursos
  @Get('courses')
  async list(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext): Promise<{ courses: InstructorCourse[] }> {
    return { courses: await this.authoring.listMine(actorOf(u, tenant)) }
  }

  @Post('courses')
  async create(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Body() dto: CreateCourseDto): Promise<{ course: InstructorCourse }> {
    const course = await this.authoring.create(actorOf(u, tenant), dto)
    this.audit.log({ tenantId: tenant.id, actorUid: u.uid, actorEmail: u.email, action: 'course.create', summary: `Criou o curso "${course.title}"`, targetType: 'course', targetId: course.id })
    return { course }
  }

  @Get('courses/:id/meta')
  async meta(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('id') id: string): Promise<{ course: InstructorCourse }> {
    return { course: await this.authoring.getOne(actorOf(u, tenant), id) }
  }

  @Get('courses/:id')
  async detail(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('id') id: string): Promise<{ modules: AuthoringModule[] }> {
    return { modules: await this.authoring.getDetail(actorOf(u, tenant), id) }
  }

  @Patch('courses/:id')
  async update(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateCourseDto): Promise<{ course: InstructorCourse }> {
    const r = await this.authoring.updateMeta(actorOf(u, tenant), id, dto)
    auditCourseChange(this.audit, u, tenant.id, r.log)
    return { course: r.course }
  }

  @Patch('courses/:id/status')
  async setStatus(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: SetStatusDto): Promise<{ status: CourseStatus }> {
    const r = await this.authoring.setStatus(actorOf(u, tenant), id, dto.status)
    // Repetir o status em que o curso já está não é troca: o service devolve log nulo e nada é gravado.
    auditCourseChange(this.audit, u, tenant.id, r.log)
    return { status: r.status }
  }

  @Delete('courses/:id')
  async remove(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('id') id: string): Promise<{ ok: true }> {
    const c = await this.authoring.remove(actorOf(u, tenant), id)
    this.audit.log({ tenantId: c.tenantId, actorUid: u.uid, actorEmail: u.email, action: 'course.delete', summary: `Excluiu o curso "${c.title}"`, targetType: 'course', targetId: c.id })
    return { ok: true }
  }

  // módulos
  @Post('courses/:id/modules')
  async createModule(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: TitleDto) {
    return this.authoring.createModule(actorOf(u, tenant), id, dto.title)
  }

  @Patch('modules/:id')
  async updateModule(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: TitleDto): Promise<{ ok: true }> {
    await this.authoring.updateModule(actorOf(u, tenant), id, dto.title)
    return { ok: true }
  }

  @Patch('modules/:id/release')
  async setModuleRelease(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: SetReleaseDto): Promise<{ ok: true }> {
    await this.authoring.setModuleRelease(actorOf(u, tenant), id, dto.availableAt ?? null)
    return { ok: true }
  }

  @Delete('modules/:id')
  async removeModule(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('id') id: string): Promise<{ ok: true }> {
    auditCourseChange(this.audit, u, tenant.id, await this.authoring.removeModule(actorOf(u, tenant), id))
    return { ok: true }
  }

  @Put('courses/:id/modules/reorder')
  async reorderModules(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: ReorderDto): Promise<{ ok: true }> {
    await this.authoring.reorderModules(actorOf(u, tenant), id, dto.orderedIds)
    return { ok: true }
  }

  // aulas
  @Post('modules/:id/lessons')
  async createLesson(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: TitleDto) {
    return this.authoring.createLesson(actorOf(u, tenant), id, dto.title)
  }

  @Patch('lessons/:id')
  async updateLesson(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateLessonDto): Promise<{ ok: true }> {
    auditCourseChange(this.audit, u, tenant.id, await this.authoring.updateLesson(actorOf(u, tenant), id, dto))
    return { ok: true }
  }

  @Delete('lessons/:id')
  async removeLesson(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('id') id: string): Promise<{ ok: true }> {
    auditCourseChange(this.audit, u, tenant.id, await this.authoring.removeLesson(actorOf(u, tenant), id))
    return { ok: true }
  }

  @Put('modules/:id/lessons/reorder')
  async reorderLessons(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: ReorderDto): Promise<{ ok: true }> {
    await this.authoring.reorderLessons(actorOf(u, tenant), id, dto.orderedIds)
    return { ok: true }
  }

  // anexos
  @Post('lessons/:id/attachments')
  async addAttachment(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: AddAttachmentDto) {
    return this.authoring.addAttachment(actorOf(u, tenant), id, dto.fileName, dto.fileUrl)
  }

  @Delete('attachments/:id')
  async removeAttachment(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('id') id: string): Promise<{ ok: true }> {
    await this.authoring.removeAttachment(actorOf(u, tenant), id)
    return { ok: true }
  }

  /**
   * Rubrica do coordenador, para o admin CONFERIR o que vai sair no diploma. Autenticada e
   * com posse verificada — o `getOne` responde 404 para curso de outro polo e 403 para curso
   * alheio. Sem cache: logo após trocar o arquivo o navegador tem que mostrar o novo, não o anterior.
   */
  @Get('courses/:id/signature')
  async signature(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('id') id: string, @Res() res: Response): Promise<void> {
    const curso = await this.authoring.getOne(actorOf(u, tenant), id)
    // Só lê objeto do prefixo do PRÓPRIO curso. `updateMeta` já barra caminho alheio ao gravar, mas um valor
    // salvo antes dessa trava não pode abrir, com a service account, objeto de outro curso (ou polo) do bucket.
    const caminho = curso.coordinatorSignaturePath
    const obj = caminho && caminho.startsWith(`cursos/${curso.id}/`) ? await this.gcs.readObject(caminho, { maxBytes: MAX_IMAGE_BYTES }) : null
    if (!obj) {
      res.status(404).send('Sem rubrica')
      return
    }
    // Mesmo cuidado da capa: o content-type vem do metadado do GCS, que quem fez upload
    // controla. Só imagem inerte vai inline; o resto vira download, para não executar como
    // página numa origem confiável.
    const safe = resolveImageResponse(obj.contentType)
    res.set('Content-Type', safe.contentType)
    if (!safe.inline) res.set('Content-Disposition', 'attachment')
    res.set('Cache-Control', 'no-store')
    res.send(obj.buffer)
  }

  // upload
  @Post('upload-url')
  async uploadUrl(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Body() dto: UploadUrlDto): Promise<UploadTicket> {
    // posse do curso NESTE polo (404 fora dele, 403 sem posse). `getOne` só confere a posse e
    // conta módulos e aulas; o `getDetail` também assinava a URL de todos os anexos só para isso.
    await this.authoring.getOne(actorOf(u, tenant), dto.courseId)
    const safeName = dto.fileName.replace(/[^a-zA-Z0-9._-]+/g, '_')
    const objectPath = `cursos/${dto.courseId}/${dto.kind}/${randomUUID()}-${safeName}`
    const uploadUrl = await this.gcs.signedUploadUrl(objectPath, dto.contentType)
    if (!uploadUrl) throw new NotFoundException('Upload indisponível (GCS não configurado).')
    return { uploadUrl, objectPath }
  }
}
