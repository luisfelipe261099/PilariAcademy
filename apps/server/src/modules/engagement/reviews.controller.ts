import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common'
import type { CourseReview, CourseReviews } from '@pilari/types'
import { Public } from '../../common/decorators/public.decorator'
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard'
import { Authenticated } from '../../common/decorators/authenticated.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { DecodedFirebaseUser } from '../../common/types/user.type'
import { CurrentTenant } from '../tenancy/current-tenant.decorator'
import type { TenantContext } from '../tenancy/tenant-context'
import { ReviewsService } from './reviews.service'
import { UpsertReviewDto } from './dto/engagement.dto'

@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  /** Público: média + lista de avaliações do curso publicado DESTE polo (sem "a minha"). Fora do ar, 404. */
  @Public()
  @Get('courses/:slug/reviews')
  async forCourse(@CurrentTenant() tenant: TenantContext, @Param('slug') slug: string): Promise<CourseReviews> {
    return this.reviews.listPublic(tenant.id, slug)
  }

  @UseGuards(FirebaseAuthGuard)
  @Authenticated()
  @Get('me/courses/:slug/reviews')
  async mine(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('slug') slug: string): Promise<CourseReviews> {
    return this.reviews.listForCourse(tenant.id, slug, u.uid)
  }

  @UseGuards(FirebaseAuthGuard)
  @Authenticated()
  @Put('me/courses/:slug/reviews')
  async upsert(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('slug') slug: string, @Body() dto: UpsertReviewDto): Promise<{ review: CourseReview }> {
    return { review: await this.reviews.upsertMine(tenant.id, u.uid, slug, dto.rating, dto.comment ?? null) }
  }
}
