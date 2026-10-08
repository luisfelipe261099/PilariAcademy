import { Global, Module } from '@nestjs/common'
import { TenantsService } from './tenants.service'
import { TenantMembersService } from './tenant-members.service'
import { CourseScopeService } from './course-scope.service'
import { PanelSalesEnabledGuard, SalesEnabledGuard, StorefrontOpenGuard } from './storefront.guards'

/** Global: todo módulo resolve o polo e o vínculo do usuário sem importar nada. */
@Global()
@Module({
  providers: [TenantsService, TenantMembersService, CourseScopeService, StorefrontOpenGuard, SalesEnabledGuard, PanelSalesEnabledGuard],
  exports: [TenantsService, TenantMembersService, CourseScopeService, StorefrontOpenGuard, SalesEnabledGuard, PanelSalesEnabledGuard],
})
export class TenancyModule {}
