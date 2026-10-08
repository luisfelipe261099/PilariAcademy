import { createParamDecorator, InternalServerErrorException, type ExecutionContext } from '@nestjs/common'
import type { RequestWithTenant } from './tenant-request'
import type { TenantContext } from './tenant-context'

/**
 * O polo do endereço acessado. O middleware garante que toda requisição que chega a um
 * controller tem polo; a ausência é erro de configuração e nunca cai na matriz por omissão.
 */
export const CurrentTenant = createParamDecorator((_data: unknown, ctx: ExecutionContext): TenantContext => {
  const req = ctx.switchToHttp().getRequest<RequestWithTenant>()
  if (!req.tenant) throw new InternalServerErrorException('Polo não resolvido para esta requisição.')
  return req.tenant
})
