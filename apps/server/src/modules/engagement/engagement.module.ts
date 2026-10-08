import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { ReviewsService } from './reviews.service'
import { NotesService } from './notes.service'
import { AnnouncementsService } from './announcements.service'
import { ReviewsController } from './reviews.controller'
import { NotesController } from './notes.controller'
import { StudentAnnouncementsController, InstructorAnnouncementsController } from './announcements.controller'

@Module({
  imports: [AuthModule],
  controllers: [ReviewsController, NotesController, StudentAnnouncementsController, InstructorAnnouncementsController],
  providers: [ReviewsService, NotesService, AnnouncementsService],
})
export class EngagementModule {}
