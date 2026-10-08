import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { EarningsService } from './earnings.service'
import { FinanceService } from './finance.service'
import { AdminFinanceController } from './admin-finance.controller'
import { InstructorEarningsController } from './instructor-earnings.controller'

@Module({
  imports: [AuthModule],
  controllers: [AdminFinanceController, InstructorEarningsController],
  providers: [EarningsService, FinanceService],
  exports: [EarningsService],
})
export class FinanceModule {}
