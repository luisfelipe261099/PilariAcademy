import { ForbiddenException, Injectable, NotFoundException, type CanActivate, type ExecutionContext } from '@nestjs/common'
import type { RequestWithTenant } from './tenant-request'
import { salesEnabled, storefrontOpen } from './sales'
import type { TenantContext } from './tenant-context'

function tenantOf(ctx: ExecutionContext): TenantContext {
  const t = ctx.switchToHttp().getRequest<RequestWithTenant>().tenant
  if (!t) throw new NotFoundException({ statusCode: 404, code: 'TENANT_NOT_FOUND', message: 'Polo não encontrado.' })
  return t
}

/** Loja aberta: polo suspenso não mostra catálogo nem vende. Sala de aula e painel não usam este guard. */
@Injectable()
export class StorefrontOpenGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (!storefrontOpen(tenantOf(ctx))) {
      throw new ForbiddenException({ statusCode: 403, code: 'TENANT_SUSPENDED', message: 'Este polo está temporariamente indisponível.' })
    }
    return true
  }
}

/** 403 de polo que ainda não vende: o mesmo `code` na loja e no painel, cada um com a mensagem de quem a lê. */
function exigeVenda(ctx: ExecutionContext, message: string): boolean {
  if (!salesEnabled(tenantOf(ctx))) throw new ForbiddenException({ statusCode: 403, code: 'TENANT_SALES_DISABLED', message })
  return true
}

/** Vendas pelo site habilitadas neste polo (etapa 1: só a matriz). Loja: a mensagem é para o aluno. */
@Injectable()
export class SalesEnabledGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    return exigeVenda(ctx, 'As matrículas pelo site deste polo ainda estão em configuração. Fale com o polo para se matricular.')
  }
}

/** A mesma trava nas rotas do painel (pedidos e cobranças): a mensagem é para quem administra o polo (B5). */
@Injectable()
export class PanelSalesEnabledGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    return exigeVenda(ctx, 'Este polo ainda não vende pela plataforma.')
  }
}
