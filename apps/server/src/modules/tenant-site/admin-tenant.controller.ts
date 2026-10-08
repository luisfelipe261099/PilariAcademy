import { Body, Controller, Get, NotFoundException, Patch, Post, UseGuards } from '@nestjs/common'
import { Role, type MyTenantSettings, type UploadTicket } from '@pilari/types'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import type { DecodedFirebaseUser } from '../../common/types/user.type'
import { AuditService } from '../audit/audit.service'
import { GcsService } from '../classroom/gcs.service'
import { EMPTY_BRANDING, publicBranding } from '../tenancy/branding'
import { brandingUploadTicket } from '../tenancy/branding-upload'
import { CurrentTenant } from '../tenancy/current-tenant.decorator'
import { salesEnabled } from '../tenancy/sales'
import type { TenantContext } from '../tenancy/tenant-context'
import { TenantsService } from '../tenancy/tenants.service'
import { BrandingUploadDto, UpdateMyTenantDto } from './dto/tenant-site.dto'

/** Minha escola: o admin do polo cuida da marca do próprio polo. Nome, endereço e status são da plataforma. */
@Controller('admin/tenant')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.admin)
export class AdminTenantController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly gcs: GcsService,
    private readonly audit: AuditService
  ) {}

  /**
   * Lê o polo no banco, não o do cache do endereço: o cache vale 60 s por instância, e quem acabou de salvar numa
   * instância não pode abrir a Minha escola em outra e ver a marca antiga.
   */
  @Get()
  async get(@CurrentTenant() tenant: TenantContext): Promise<MyTenantSettings> {
    const atual = await this.tenants.getById(tenant.id)
    if (!atual) throw new NotFoundException({ statusCode: 404, code: 'TENANT_NOT_FOUND', message: 'Polo não encontrado.' })
    return this.settingsOf(atual)
  }

  @Patch()
  async update(
    @CurrentUser() u: DecodedFirebaseUser,
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: UpdateMyTenantDto
  ): Promise<MyTenantSettings> {
    const novo = await this.tenants.update(tenant.id, { branding: dto.branding })
    // Só nomes de campo da marca vão para o resumo: o corpo é livre e o resumo da auditoria tem 500 caracteres.
    const campos = Object.keys(dto.branding).filter((campo) => Object.hasOwn(EMPTY_BRANDING, campo))
    this.audit.log({
      tenantId: tenant.id, actorUid: u.uid, actorEmail: u.email, action: 'tenant.branding',
      summary: `Alterou a marca do polo: ${campos.join(', ') || 'nenhum campo'}`, targetType: 'tenant', targetId: tenant.id,
    })
    return this.settingsOf(novo)
  }

  @Post('upload-url')
  uploadUrl(@CurrentTenant() tenant: TenantContext, @Body() dto: BrandingUploadDto): Promise<UploadTicket> {
    return brandingUploadTicket(this.gcs, tenant.id, dto)
  }

  private settingsOf(t: TenantContext): MyTenantSettings {
    return {
      slug: t.slug,
      name: t.name,
      siteUrl: this.tenants.siteUrl(t),
      isMatriz: t.isMatriz,
      salesEnabled: salesEnabled(t),
      branding: t.branding,
      publicBranding: publicBranding(t.branding, t.updatedAt.getTime()),
    }
  }
}
