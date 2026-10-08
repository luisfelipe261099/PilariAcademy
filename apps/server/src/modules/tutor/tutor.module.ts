import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AuthModule } from '../auth/auth.module'
import { GcsService } from '../classroom/gcs.service'
import { TutorController } from './tutor.controller'
import { TutorMaterialService } from './tutor-material.service'
import { TutorService } from './tutor.service'
import { VertexClient } from './vertex.client'

@Module({
  imports: [ConfigModule, AuthModule],
  controllers: [TutorController],
  providers: [GcsService, VertexClient, TutorMaterialService, TutorService],
})
export class TutorModule {}
