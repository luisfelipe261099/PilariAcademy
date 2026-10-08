import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { Role } from '@pilari/types'
import type { ConversationSummary, Message, MessageThread } from '@pilari/types'
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { DecodedFirebaseUser } from '../../common/types/user.type'
import { actorOf } from '../../common/types/actor.type'
import { CurrentTenant } from '../tenancy/current-tenant.decorator'
import type { TenantContext } from '../tenancy/tenant-context'
import { MessagesService } from './messages.service'
import { SendMessageDto } from './dto/message.dto'

@Controller('instructor')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.teacher, Role.admin)
export class InstructorMessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get('conversations')
  async conversations(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext): Promise<{ conversations: ConversationSummary[] }> {
    return { conversations: await this.messages.instructorConversations(actorOf(u, tenant)) }
  }

  @Get('courses/:courseId/students/:studentId/messages')
  async thread(
    @CurrentUser() u: DecodedFirebaseUser,
    @CurrentTenant() tenant: TenantContext,
    @Param('courseId') courseId: string,
    @Param('studentId') studentId: string
  ): Promise<MessageThread> {
    return this.messages.instructorThread(actorOf(u, tenant), courseId, studentId)
  }

  @Post('courses/:courseId/students/:studentId/messages')
  async send(
    @CurrentUser() u: DecodedFirebaseUser,
    @CurrentTenant() tenant: TenantContext,
    @Param('courseId') courseId: string,
    @Param('studentId') studentId: string,
    @Body() dto: SendMessageDto
  ): Promise<{ message: Message }> {
    return { message: await this.messages.instructorSend(actorOf(u, tenant), courseId, studentId, dto.body) }
  }
}
