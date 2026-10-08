import { httpClient } from '@/shared/api/http-client'
import type { Category } from '@pilari/types'

export async function listCategories(): Promise<Category[]> {
  const { data } = await httpClient.get<{ categories: Category[] }>('/categories')
  return data.categories
}

export async function createCategory(name: string): Promise<Category> {
  const { data } = await httpClient.post<{ category: Category }>('/admin/categories', { name })
  return data.category
}

export async function updateCategory(id: string, name: string): Promise<Category> {
  const { data } = await httpClient.patch<{ category: Category }>(`/admin/categories/${id}`, { name })
  return data.category
}

export async function deleteCategory(id: string): Promise<void> {
  await httpClient.delete(`/admin/categories/${id}`)
}
