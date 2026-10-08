import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { CoursesController } from './courses.controller'
import { AdminCategoriesController } from './admin-categories.controller'
import { CoursesService } from './courses.service'
import { CategoriesService } from './categories.service'
import { GcsService } from '../classroom/gcs.service'

@Module({
  imports: [AuthModule], // FirebaseAuthGuard depende dos providers de auth
  controllers: [CoursesController, AdminCategoriesController],
  providers: [CoursesService, CategoriesService, GcsService],
})
export class CoursesModule {}
