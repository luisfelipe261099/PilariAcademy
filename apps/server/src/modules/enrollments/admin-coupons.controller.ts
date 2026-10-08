import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common'
import type { Coupon } from '@pilari/types'
import { Role } from '@pilari/types'
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentTenant } from '../tenancy/current-tenant.decorator'
import type { TenantContext } from '../tenancy/tenant-context'
import { CouponsService } from './coupons.service'
import { CreateCouponDto, UpdateCouponDto } from './dto/coupon.dto'

@Controller('admin/coupons')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.admin)
export class AdminCouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  @Get()
  async list(@CurrentTenant() tenant: TenantContext): Promise<{ coupons: Coupon[] }> {
    return { coupons: await this.couponsService.list(tenant.id) }
  }

  @Post()
  async create(@CurrentTenant() tenant: TenantContext, @Body() dto: CreateCouponDto): Promise<{ coupon: Coupon }> {
    // validUntil chega como ISO string → converte para Date (coluna timestamp).
    return { coupon: await this.couponsService.create(tenant.id, { ...dto, validUntil: dto.validUntil ? new Date(dto.validUntil) : null }) }
  }

  @Patch(':id')
  async update(@CurrentTenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateCouponDto): Promise<{ coupon: Coupon }> {
    const { validUntil, ...rest } = dto
    return {
      coupon: await this.couponsService.update(tenant.id, id, {
        ...rest,
        ...(validUntil !== undefined ? { validUntil: validUntil ? new Date(validUntil) : null } : {}),
      }),
    }
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentTenant() tenant: TenantContext, @Param('id') id: string): Promise<void> {
    await this.couponsService.remove(tenant.id, id)
  }
}
