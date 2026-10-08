import { Body, Controller, Delete, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common'
import type { Category } from '@pilari/types'
import { Role } from '@pilari/types'
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentTenant } from '../tenancy/current-tenant.decorator'
import type { TenantContext } from '../tenancy/tenant-context'
import { CategoriesService } from './categories.service'
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto'

@Controller('admin/categories')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.admin)
export class AdminCategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  async create(@CurrentTenant() tenant: TenantContext, @Body() dto: CreateCategoryDto): Promise<{ category: Category }> {
    return { category: await this.categoriesService.create(tenant.id, dto.name) }
  }

  @Patch(':id')
  async update(@CurrentTenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateCategoryDto): Promise<{ category: Category }> {
    return { category: await this.categoriesService.update(tenant.id, id, dto.name) }
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentTenant() tenant: TenantContext, @Param('id') id: string): Promise<void> {
    await this.categoriesService.remove(tenant.id, id)
  }
}
