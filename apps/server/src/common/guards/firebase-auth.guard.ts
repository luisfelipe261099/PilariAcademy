import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'
import { Request } from 'express'
import type { DecodedFirebaseUser } from '../types/user.type'
import { effectiveRoles, isEffectivePlatformAdmin } from '../lib/effective-roles'
import { PUBLIC_KEY } from '../decorators/public.decorator'
import { IdentityService } from '../../modules/auth/identity.service'
import { AuthService } from '../../modules/auth/auth.service'
import { TenantMembersService } from '../../modules/tenancy/tenant-members.service'
import type { RequestWithTenant } from '../../modules/tenancy/tenant-request'

@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  private readonly logger = new Logger(FirebaseAuthGuard.name)

  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
    private readonly identityService: IdentityService,
    private readonly authService: AuthService,
    private readonly members: TenantMembersService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // @Public() → rota aberta (catálogo, webhook, verificação de certificado, resumo do carrinho).
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const request = context.switchToHttp().getRequest<RequestWithTenant & { user?: DecodedFirebaseUser }>()
    // Já autenticado nesta requisição (o guard global rodou antes do guard do controller):
    // evita verificar o token duas vezes (cada verifyIdToken bate no Firebase).
    if (request.user?.uid) return true

    if (this.config.get<string>('AUTH_REQUIRED') !== '1') {
      this.logger.error('❌ AUTH_REQUIRED=0 não é permitido!')
      throw new UnauthorizedException('Configuração de segurança inválida')
    }

    const token = this.extractTokenFromHeader(request)

    if (!token) {
      this.logger.warn('Token de autorização não fornecido')
      throw new UnauthorizedException('Token não fornecido')
    }

    try {
      const decodedToken = await this.identityService.verifyIdToken(token, true)

      const dbUser = await this.authService.getUserByUid(decodedToken.uid)
      if (dbUser?.disabled) {
        this.logger.warn(`Acesso negado: usuário ${decodedToken.uid} desabilitado no banco`)
        throw new UnauthorizedException('Conta desabilitada')
      }

      // Papéis: SÓ do banco (ID-08), agora por polo. O vínculo (tenant_members) do polo do
      // endereço define o que a pessoa pode fazer AQUI; a equipe da plataforma ganha admin em
      // qualquer polo. Sem registro (primeiro login) ou sem vínculo, roles = [] — passa só em
      // @Authenticated(), o suficiente para o /auth/sync-user-data criar o vínculo de aluno.
      // Admin da plataforma é o EFETIVO (B10): o sinal do cadastro ou o admin da matriz. Por isso,
      // no endereço de um polo, o vínculo da matriz vem junto, na mesma consulta.
      const vinculos = dbUser
        ? await this.members.rolesHereAndInMatriz(request.tenant?.id, decodedToken.uid)
        : { roles: null, matrizRoles: null }
      const isPlatformAdmin = isEffectivePlatformAdmin(dbUser?.isPlatformAdmin, vinculos.matrizRoles)

      request.user = {
        uid: decodedToken.uid,
        email: decodedToken.email || '',
        roles: effectiveRoles(vinculos.roles ?? [], isPlatformAdmin),
        isPlatformAdmin,
      }
      return true
    } catch (error: unknown) {
      // Erros que já viraram UnauthorizedException (ex.: conta desabilitada) sobem como estão.
      if (error instanceof UnauthorizedException) throw error

      const err = error as { code?: string; message?: string }
      switch (err.code) {
        case 'auth/id-token-expired':
          this.logger.warn('Token expirado')
          throw new UnauthorizedException('Token expirado. Faça login novamente')
        case 'auth/id-token-revoked':
          this.logger.warn('Token foi revogado')
          throw new UnauthorizedException('Sessão revogada. Faça login novamente')
        case 'auth/invalid-id-token':
        case 'auth/argument-error':
          this.logger.warn('Token inválido ou mal formado')
          throw new UnauthorizedException('Token inválido')
        case 'auth/user-disabled':
          throw new UnauthorizedException('Conta desabilitada')
        default:
          this.logger.error('Erro ao verificar token:', err.message)
          throw new UnauthorizedException('Falha na autenticação')
      }
    }
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const authHeader = request.headers.authorization
    if (!authHeader) return undefined
    const [type, token] = authHeader.split(' ')
    return type === 'Bearer' ? token : undefined
  }
}
