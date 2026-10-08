import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { CartSummary, CheckoutResult, Enrollment, MyOrder } from '@pilari/types'
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard'
import { Public } from '../../common/decorators/public.decorator'
import { Authenticated } from '../../common/decorators/authenticated.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { DecodedFirebaseUser } from '../../common/types/user.type'
import { CurrentTenant } from '../tenancy/current-tenant.decorator'
import type { TenantContext } from '../tenancy/tenant-context'
import { StorefrontOpenGuard, SalesEnabledGuard } from '../tenancy/storefront.guards'
import { CheckoutService } from './checkout.service'
import { EnrollmentsService } from './enrollments.service'
import { CartService } from './cart.service'
import { MyOrdersService } from './my-orders.service'
import { CheckoutDto, CartSummaryDto } from './dto/checkout.dto'

// Guard aplicado POR MÉTODO (não na classe): o resumo do carrinho é público —
// o visitante precisa ver preço/total ANTES de logar. Login é exigido só no checkout.
@Controller()
export class CheckoutController {
  constructor(
    private readonly checkoutService: CheckoutService,
    private readonly enrollmentsService: EnrollmentsService,
    private readonly cartService: CartService,
    private readonly myOrders: MyOrdersService
  ) {}

  // Público: só calcula preços a partir dos courseIds + cupom (não usa usuário).
  // Rate limit apertado (10/min/IP, bem abaixo do global de 120): aceita `couponCode` e é
  // público, então seria o vetor de enumeração de cupons de baixa entropia. Ninguém legítimo
  // recalcula o carrinho 10x/min.
  @Public()
  @UseGuards(StorefrontOpenGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('cart/summary')
  async cartSummary(@CurrentTenant() tenant: TenantContext, @Body() dto: CartSummaryDto): Promise<CartSummary> {
    return this.cartService.summary(tenant.id, dto.courseIds, dto.couponCode)
  }

  /** Pedidos do próprio aluno (Financeiro). O filtro por uid e por polo mora no serviço. */
  @Get('me/orders')
  @UseGuards(FirebaseAuthGuard)
  @Authenticated()
  async myOrdersList(@CurrentUser() user: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext): Promise<MyOrder[]> {
    return this.myOrders.list(tenant.id, user.uid)
  }

  @Post('checkout')
  @UseGuards(FirebaseAuthGuard, StorefrontOpenGuard, SalesEnabledGuard)
  @Authenticated()
  async checkout(@CurrentUser() user: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Body() dto: CheckoutDto): Promise<CheckoutResult> {
    return this.checkoutService.checkout(tenant.id, user.uid, dto.courseIds, {
      couponCode: dto.couponCode,
      cpf: dto.cpf,
      paymentMode: dto.paymentMode ?? 'avista',
      installmentCount: dto.installmentCount,
    })
  }

  @Get('me/enrollments')
  @UseGuards(FirebaseAuthGuard)
  @Authenticated()
  async myEnrollments(@CurrentUser() user: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext): Promise<{ enrollments: Enrollment[] }> {
    return { enrollments: await this.enrollmentsService.listForUser(tenant.id, user.uid) }
  }
}
