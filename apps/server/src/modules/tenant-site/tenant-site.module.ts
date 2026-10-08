import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { GcsService } from '../classroom/gcs.service'
import { AdminTenantController } from './admin-tenant.controller'
import { AppIconService } from './app-icon.service'
import { TenantPublicController } from './tenant-public.controller'

@Module({
  imports: [AuthModule],
  controllers: [TenantPublicController, AdminTenantController],
  providers: [GcsService, AppIconService],
})
export class TenantSiteModule {}
