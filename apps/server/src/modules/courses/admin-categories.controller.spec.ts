/// <reference types="jest" />
import type { TenantContext } from '../tenancy/tenant-context'
import { AdminCategoriesController } from './admin-categories.controller'

const TENANT = { id: 't-a', isMatriz: false, status: 'active' } as TenantContext

function make() {
  const categoriesService = {
    create: jest.fn(async (_tenantId: string, name: string) => ({ id: '1', name, slug: 'slug' })),
    update: jest.fn(async (_tenantId: string, id: string, name: string) => ({ id, name, slug: 'slug' })),
    remove: jest.fn(async () => undefined),
  }
  return { controller: new AdminCategoriesController(categoriesService as never), categoriesService }
}

describe('AdminCategoriesController', () => {
  it('cria categoria via service', async () => {
    const { controller, categoriesService } = make()
    const res = await controller.create(TENANT, { name: 'Tecnologia' })
    expect(categoriesService.create).toHaveBeenCalledWith('t-a', 'Tecnologia')
    expect(res.category.name).toBe('Tecnologia')
  })

  it('atualiza categoria via service', async () => {
    const { controller, categoriesService } = make()
    await controller.update(TENANT, '1', { name: 'Novo' })
    expect(categoriesService.update).toHaveBeenCalledWith('t-a', '1', 'Novo')
  })

  it('remove categoria via service', async () => {
    const { controller, categoriesService } = make()
    await controller.remove(TENANT, '1')
    expect(categoriesService.remove).toHaveBeenCalledWith('t-a', '1')
  })
})
