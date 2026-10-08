import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common'
import type { CreateTenantResult, PlatformTenantDetail, PlatformTenantRow, TenantAdminResult, UploadTicket } from '@pilari/types'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { PlatformAdmin } from '../../common/decorators/platform-admin.decorator'
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import type { DecodedFirebaseUser } from '../../common/types/user.type'
import { AuditService } from '../audit/audit.service'
import { GcsService } from '../classroom/gcs.service'
import { brandingUploadTicket } from '../tenancy/branding-upload'
import { normalizeHost } from '../tenancy/host'
import { BrandingUploadDto } from '../tenant-site/dto/tenant-site.dto'
import { AddDomainDto, AddTenantAdminDto, CreateTenantDto, UpdateTenantDto } from './dto/platform.dto'
import { PlatformTenantsService } from './platform-tenants.service'

/**
 * O domínio como ficou gravado (minúsculo, sem porta e sem ponto final), para o resumo da auditoria. O serviço já o
 * validou com a mesma função, então o `??` só cobre o impossível: o log nunca fica sem o que o operador mandou.
 */
const hostGravado = (bruto: string): string => normalizeHost(bruto) ?? bruto

/**
 * Console do Studio Pilari: polos da rede. Toda ação que afeta um polo é auditada com o tenantId DELE (B6): aparece no log do
 * polo e no da rede (que mostra o nome do polo). Os resumos levam o nome do polo, não o id.
 */
@Controller('platform/tenants')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@PlatformAdmin()
export class PlatformTenantsController {
  constructor(
    private readonly svc: PlatformTenantsService,
    private readonly gcs: GcsService,
    private readonly audit: AuditService
  ) {}

  @Get()
  async list(): Promise<{ tenants: PlatformTenantRow[] }> {
    return { tenants: await this.svc.list() }
  }

  @Get(':id')
  detail(@Param('id') id: string): Promise<PlatformTenantDetail> {
    return this.svc.detail(id)
  }

  @Post()
  async create(@CurrentUser() u: DecodedFirebaseUser, @Body() dto: CreateTenantDto): Promise<CreateTenantResult> {
    // A marca é opcional no corpo (o DTO aceita sem ela); o serviço recebe sempre um objeto.
    const r = await this.svc.create({ ...dto, branding: dto.branding ?? {} })
    this.audit.log({
      tenantId: r.tenant.id, actorUid: u.uid, actorEmail: u.email, action: 'tenant.create',
      summary: `Criou o polo ${r.tenant.name} (${r.tenant.slug}) com o admin ${r.firstAdmin.email}`, targetType: 'tenant', targetId: r.tenant.id,
    })
    return r
  }

  @Patch(':id')
  async update(@CurrentUser() u: DecodedFirebaseUser, @Param('id') id: string, @Body() dto: UpdateTenantDto): Promise<PlatformTenantDetail> {
    const r = await this.svc.update(id, dto)
    const campos = [dto.name !== undefined ? 'nome' : null, dto.status !== undefined ? `status → ${dto.status}` : null, dto.branding ? 'marca' : null].filter(Boolean)
    this.audit.log({
      tenantId: id, actorUid: u.uid, actorEmail: u.email, action: 'tenant.update',
      summary: `Alterou o polo ${r.name}: ${campos.join(', ')}`, targetType: 'tenant', targetId: id,
    })
    return r
  }

  @Post(':id/admins')
  async addAdmin(@CurrentUser() u: DecodedFirebaseUser, @Param('id') id: string, @Body() dto: AddTenantAdminDto): Promise<TenantAdminResult> {
    const r = await this.svc.addAdmin(id, dto.email, dto.name)
    const polo = await this.svc.mustGet(id)
    this.audit.log({
      tenantId: id, actorUid: u.uid, actorEmail: u.email, action: 'tenant.admin-add',
      summary: `Vinculou ${r.email} como admin do polo ${polo.name}`, targetType: 'tenant', targetId: id,
    })
    return r
  }

  @Post(':id/domains')
  async addDomain(@CurrentUser() u: DecodedFirebaseUser, @Param('id') id: string, @Body() dto: AddDomainDto): Promise<PlatformTenantDetail> {
    const r = await this.svc.addDomain(id, dto.host)
    this.audit.log({
      tenantId: id, actorUid: u.uid, actorEmail: u.email, action: 'tenant.domain-add',
      summary: `Cadastrou o domínio ${hostGravado(dto.host)} no polo ${r.name}`, targetType: 'tenant', targetId: id,
    })
    return r
  }

  @Delete(':id/domains/:host')
  async removeDomain(@CurrentUser() u: DecodedFirebaseUser, @Param('id') id: string, @Param('host') host: string): Promise<PlatformTenantDetail> {
    const r = await this.svc.removeDomain(id, host)
    this.audit.log({
      tenantId: id, actorUid: u.uid, actorEmail: u.email, action: 'tenant.domain-remove',
      summary: `Removeu o domínio ${hostGravado(host)} do polo ${r.name}`, targetType: 'tenant', targetId: id,
    })
    return r
  }

  @Post(':id/upload-url')
  async uploadUrl(@Param('id') id: string, @Body() dto: BrandingUploadDto): Promise<UploadTicket> {
    await this.svc.assertExists(id)
    return brandingUploadTicket(this.gcs, id, dto)
  }
}
