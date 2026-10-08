import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import type { Message, MessageThread } from '@pilari/types'
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard'
import { Authenticated } from '../../common/decorators/authenticated.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { DecodedFirebaseUser } from '../../common/types/user.type'
import { CurrentTenant } from '../tenancy/current-tenant.decorator'
import type { TenantContext } from '../tenancy/tenant-context'
import { MessagesService } from './messages.service'
import { SendMessageDto } from './dto/message.dto'

@Controller('me')
@UseGuards(FirebaseAuthGuard)
@Authenticated()
export class StudentMessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get('courses/:slug/messages')
  async thread(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('slug') slug: string): Promise<MessageThread> {
    return this.messages.studentThread(tenant.id, u.uid, slug)
  }

  @Post('courses/:slug/messages')
  async send(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('slug') slug: string, @Body() dto: SendMessageDto): Promise<{ message: Message }> {
    return { message: await this.messages.studentSend(tenant.id, u.uid, slug, dto.body) }
  }
}
