import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AuthModule } from '../auth/auth.module'
import { AuthoringService } from './authoring.service'
import { GcsService } from '../classroom/gcs.service'
import { InstructorController } from './instructor.controller'

@Module({
  imports: [ConfigModule, AuthModule],
  controllers: [InstructorController],
  providers: [AuthoringService, GcsService],
})
export class AuthoringModule {}
