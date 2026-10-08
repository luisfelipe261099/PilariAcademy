import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import type { CourseGrades, QuizForStudent, QuizResult } from '@pilari/types'
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard'
import { Authenticated } from '../../common/decorators/authenticated.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { DecodedFirebaseUser } from '../../common/types/user.type'
import { CurrentTenant } from '../tenancy/current-tenant.decorator'
import type { TenantContext } from '../tenancy/tenant-context'
import { QuizService } from './quiz.service'
import { SubmitQuizDto } from './dto/quiz.dto'

@Controller('me')
@UseGuards(FirebaseAuthGuard)
@Authenticated()
export class StudentQuizController {
  constructor(private readonly quiz: QuizService) {}

  @Get('modules/:id/quiz')
  async get(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('id') id: string): Promise<QuizForStudent> {
    return this.quiz.getForStudent(tenant.id, u.uid, id)
  }

  @Post('modules/:id/quiz/submit')
  async submit(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: SubmitQuizDto): Promise<QuizResult> {
    return this.quiz.submit(tenant, u.uid, id, dto.answers)
  }

  @Get('courses/:slug/grades')
  async grades(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('slug') slug: string): Promise<CourseGrades> {
    return this.quiz.courseGradeBySlug(tenant.id, u.uid, slug)
  }
}
