import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { MessagesService } from './messages.service'
import { StudentMessagesController } from './student-messages.controller'
import { InstructorMessagesController } from './instructor-messages.controller'

@Module({
  imports: [AuthModule],
  controllers: [StudentMessagesController, InstructorMessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
