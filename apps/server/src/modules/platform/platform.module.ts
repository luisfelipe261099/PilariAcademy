import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { GcsService } from '../classroom/gcs.service'
import { PlatformReviewController } from './platform-review.controller'
import { PlatformReviewService } from './platform-review.service'
import { PlatformTenantsController } from './platform-tenants.controller'
import { PlatformTenantsService } from './platform-tenants.service'

@Module({
  imports: [AuthModule],
  controllers: [PlatformTenantsController, PlatformReviewController],
  providers: [PlatformTenantsService, PlatformReviewService, GcsService],
})
export class PlatformModule {}
