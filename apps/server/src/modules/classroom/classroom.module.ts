import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AuthModule } from '../auth/auth.module'
import { GcsService } from './gcs.service'
import { ClassroomService } from './classroom.service'
import { ProgressService } from './progress.service'
import { ClassroomController } from './classroom.controller'
import { FileProxyController } from './file-proxy.controller'
import { FileProxyService } from './file-proxy.service'

@Module({
  imports: [ConfigModule, AuthModule],
  controllers: [ClassroomController, FileProxyController],
  providers: [GcsService, ClassroomService, ProgressService, FileProxyService],
})
export class ClassroomModule {}
