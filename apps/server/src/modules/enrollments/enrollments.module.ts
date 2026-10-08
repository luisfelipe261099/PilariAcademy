import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AuthModule } from '../auth/auth.module'
import { FinanceModule } from '../finance/finance.module'
import { AsaasService } from './asaas.service'
import { CheckoutService } from './checkout.service'
import { EnrollmentsService } from './enrollments.service'
import { WebhookService } from './webhook.service'
import { CouponsService } from './coupons.service'
import { CartService } from './cart.service'
import { InstallmentsService } from './installments.service'
import { ReconcileCron } from './reconcile.cron'
import { CheckoutController } from './checkout.controller'
import { WebhookController } from './webhook.controller'
import { AdminCouponsController } from './admin-coupons.controller'
import { AdminReconcileController } from './admin-reconcile.controller'
import { AdminOrdersController } from './admin-orders.controller'
import { AdminOrdersService } from './admin-orders.service'
import { AdminBillingController } from './admin-billing.controller'
import { AdminBillingService } from './admin-billing.service'
import { MyOrdersService } from './my-orders.service'

@Module({
  imports: [ConfigModule, AuthModule, FinanceModule], // AuthModule p/ FirebaseAuthGuard
  controllers: [CheckoutController, WebhookController, AdminCouponsController, AdminReconcileController, AdminOrdersController, AdminBillingController],
  providers: [
    AsaasService,
    CheckoutService,
    EnrollmentsService,
    WebhookService,
    CouponsService,
    CartService,
    AdminOrdersService,
    AdminBillingService,
    MyOrdersService,
    InstallmentsService,
    ReconcileCron,
  ],
  // AsaasService também exportado: o certificado precisa de `getPaymentBook` para o proxy
  // do carnê (a chave de API do Asaas nunca pode ir para o navegador).
  exports: [InstallmentsService, AsaasService],
})
export class EnrollmentsModule {}
