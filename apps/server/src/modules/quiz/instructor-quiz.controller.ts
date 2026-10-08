import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { Role } from '@pilari/types'
import type { AuthoringQuestion, CourseGrades } from '@pilari/types'
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { DecodedFirebaseUser } from '../../common/types/user.type'
import { actorOf } from '../../common/types/actor.type'
import { CurrentTenant } from '../tenancy/current-tenant.decorator'
import type { TenantContext } from '../tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import { auditCourseChange } from '../authoring/course-change-log'
import { QuizService } from './quiz.service'
import { CreateQuestionDto, UpdateQuestionDto } from './dto/quiz.dto'

@Controller('instructor')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.teacher, Role.admin)
export class InstructorQuizController {
  constructor(
    private readonly quiz: QuizService,
    private readonly audit: AuditService
  ) {}

  @Get('modules/:id/questions')
  async list(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('id') id: string): Promise<{ questions: AuthoringQuestion[] }> {
    return { questions: await this.quiz.listQuestions(actorOf(u, tenant), id) }
  }

  @Post('modules/:id/questions')
  async create(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: CreateQuestionDto) {
    return this.quiz.createQuestion(actorOf(u, tenant), id, dto)
  }

  @Patch('questions/:id')
  async update(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateQuestionDto): Promise<{ ok: true }> {
    await this.quiz.updateQuestion(actorOf(u, tenant), id, dto)
    return { ok: true }
  }

  @Delete('questions/:id')
  async remove(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('id') id: string): Promise<{ ok: true }> {
    auditCourseChange(this.audit, u, tenant.id, await this.quiz.removeQuestion(actorOf(u, tenant), id))
    return { ok: true }
  }

  /** Boletim de um aluno num curso (nota por módulo + final). */
  @Get('courses/:courseId/students/:uid/grades')
  async studentGrades(
    @CurrentUser() u: DecodedFirebaseUser,
    @CurrentTenant() tenant: TenantContext,
    @Param('courseId') courseId: string,
    @Param('uid') studentUid: string
  ): Promise<CourseGrades> {
    return this.quiz.courseGradeForStaff(actorOf(u, tenant), courseId, studentUid)
  }

  /** Libera +5 tentativas de prova em todo o curso para um aluno (repetente). */
  @Post('courses/:courseId/students/:uid/quiz-release')
  async release(
    @CurrentUser() u: DecodedFirebaseUser,
    @CurrentTenant() tenant: TenantContext,
    @Param('courseId') courseId: string,
    @Param('uid') studentUid: string
  ): Promise<{ ok: true }> {
    return this.quiz.releaseCourseQuizzes(actorOf(u, tenant), courseId, studentUid)
  }
}
