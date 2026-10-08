import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { QuizService } from './quiz.service'
import { InstructorQuizController } from './instructor-quiz.controller'
import { StudentQuizController } from './student-quiz.controller'

@Module({
  imports: [AuthModule],
  controllers: [InstructorQuizController, StudentQuizController],
  providers: [QuizService],
  exports: [QuizService],
})
export class QuizModule {}
