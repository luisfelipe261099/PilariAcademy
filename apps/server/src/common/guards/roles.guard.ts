import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Role } from '@pilari/types'
import { ROLES_KEY } from '../decorators/roles.decorator'
import { PUBLIC_KEY } from '../decorators/public.decorator'
import { AUTHENTICATED_KEY } from '../decorators/authenticated.decorator'
import { PLATFORM_ADMIN_KEY } from '../decorators/platform-admin.decorator'

/**
 * A negação do guard, em português e com `code` estável (B5). Devolver `false` faria o Nest responder o genérico
 * "Forbidden resource", em inglês e sem code.
 */
function negado(): ForbiddenException {
  return new ForbiddenException({ statusCode: 403, code: 'FORBIDDEN', message: 'Você não tem permissão para esta ação neste endereço.' })
}

/**
 * Guard global de autorização (roda DEPOIS do FirebaseAuthGuard). Deny-by-default: uma rota
 * é negada a menos que declare explicitamente @Public() (aberta), @Authenticated() (qualquer
 * logado) ou @Roles(...) (papéis específicos). Assim um controller novo que esqueça de declarar
 * o acesso não nasce aberto a qualquer usuário autenticado. Toda negação lança o 403 de `negado()`.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name)

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    // @PlatformAdmin() vem ANTES do @Authenticated(): um controller @Authenticated() pode ter
    // um método exclusivo da plataforma, e getAllAndOverride devolveria o da classe.
    const platformOnly = this.reflector.getAllAndOverride<boolean>(PLATFORM_ADMIN_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (platformOnly) {
      const req = context.switchToHttp().getRequest<{ user?: { uid?: string; isPlatformAdmin?: boolean } }>()
      if (req.user?.isPlatformAdmin !== true) {
        this.logger.warn(`Acesso negado (só plataforma) para uid=${req.user?.uid}`)
        throw negado()
      }
      return true
    }

    // @Authenticated(): basta estar logado — o FirebaseAuthGuard já verificou o token.
    const authenticatedOnly = this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (authenticatedOnly) return true

    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    if (!requiredRoles || requiredRoles.length === 0) {
      this.logger.warn(
        `Acesso negado: ${context.getClass().name}.${context.getHandler().name} sem @Roles(), @Authenticated() ou @Public()`
      )
      throw negado()
    }

    const request = context.switchToHttp().getRequest<{ user?: { uid?: string; roles?: Role[] } }>()
    const userRoles = request.user?.roles ?? []

    if (!userRoles.some((r) => requiredRoles.includes(r))) {
      this.logger.warn(
        `Acesso negado para uid=${request.user?.uid}: roles=${JSON.stringify(userRoles)}, exigidas=${JSON.stringify(requiredRoles)}`
      )
      throw negado()
    }
    return true
  }
}
