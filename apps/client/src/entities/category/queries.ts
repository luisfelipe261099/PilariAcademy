import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createCategory, deleteCategory, listCategories, updateCategory } from './api'

export const CATEGORIES_KEY = ['categories'] as const

export const categoriesQueryOptions = queryOptions({
  queryKey: CATEGORIES_KEY,
  queryFn: listCategories,
})

export function useCategoriesQuery() {
  return useQuery(categoriesQueryOptions)
}

export function useCreateCategoryMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => createCategory(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: CATEGORIES_KEY }),
  })
}

export function useUpdateCategoryMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateCategory(id, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: CATEGORIES_KEY }),
  })
}

export function useDeleteCategoryMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteCategory(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: CATEGORIES_KEY }),
  })
}
