import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { AdminUsersController } from './admin-users.controller'
import { AdminDashboardController } from './admin-dashboard.controller'
import { AdminService } from './admin.service'

@Module({
  imports: [AuthModule],
  controllers: [AdminUsersController, AdminDashboardController],
  providers: [AdminService],
})
export class AdminModule {}
