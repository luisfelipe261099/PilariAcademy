import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import { Request } from 'express'
import type { DecodedFirebaseUser } from '../types/user.type'

/** Injeta o usuário autenticado (populado pelo FirebaseAuthGuard) num parâmetro do handler. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<Request & { user: DecodedFirebaseUser }>()
  return request.user
})
