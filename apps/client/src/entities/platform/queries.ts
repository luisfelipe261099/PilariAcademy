import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { CreateTenantInput, PlatformTenantDetail, TenantBrandingInput, UpdateTenantInput } from '@pilari/types'
import { ADMIN_COURSES_KEY } from '@/entities/admin-dashboard'
import {
  addPlatformTenantAdmin, addPlatformTenantDomain, approveCourse, createPlatformTenant, getPlatformLogs, getPlatformTenant,
  getReviewQueue, listPlatformTenants, removePlatformTenantDomain, returnCourse, takedownCourse, updatePlatformTenant,
} from './api'
import { apiErrorCode } from './lib/api-error'

export const PLATFORM_TENANTS_KEY = ['platform', 'tenants'] as const
export const platformTenantKey = (id: string) => ['platform', 'tenant', id] as const
/** Prefixo do detalhe de todo polo (não confunde com PLATFORM_TENANTS_KEY, a lista): invalida o detalhe de qualquer polo em cache. */
export const PLATFORM_TENANT_DETAILS_KEY = ['platform', 'tenant'] as const
export const REVIEW_QUEUE_KEY = ['platform', 'review-queue'] as const
export const PLATFORM_LOGS_KEY = ['platform', 'logs'] as const

export function usePlatformTenantsQuery() {
  return useQuery({ queryKey: PLATFORM_TENANTS_KEY, queryFn: listPlatformTenants })
}
export function usePlatformTenantQuery(id: string) {
  return useQuery({
    queryKey: platformTenantKey(id),
    queryFn: () => getPlatformTenant(id),
    enabled: Boolean(id),
    // Polo que não existe (404 TENANT_NOT_FOUND) não aparece na segunda tentativa: a tela responde na hora.
    retry: (falhas, error) => apiErrorCode(error) !== 'TENANT_NOT_FOUND' && falhas < 1,
  })
}
export function useCreatePlatformTenantMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateTenantInput) => createPlatformTenant(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: PLATFORM_TENANTS_KEY }),
  })
}
/**
 * Mutações sobre um polo: atualizam o detalhe e a lista. `update` (nome e situação) e `saveBranding` (marca) são
 * mutações separadas para o erro e o "salvando" de uma não aparecerem na outra seção da tela.
 */
export function usePlatformTenantMutations(id: string) {
  const qc = useQueryClient()
  const aposMudar = (detalhe?: PlatformTenantDetail) => {
    if (detalhe) qc.setQueryData(platformTenantKey(id), detalhe)
    else void qc.invalidateQueries({ queryKey: platformTenantKey(id) })
    void qc.invalidateQueries({ queryKey: PLATFORM_TENANTS_KEY })
  }
  return {
    update: useMutation({ mutationFn: (input: UpdateTenantInput) => updatePlatformTenant(id, input), onSuccess: aposMudar }),
    saveBranding: useMutation({ mutationFn: (branding: TenantBrandingInput) => updatePlatformTenant(id, { branding }), onSuccess: aposMudar }),
    addAdmin: useMutation({
      mutationFn: (input: { email: string; name: string }) => addPlatformTenantAdmin(id, input),
      onSuccess: () => aposMudar(),
    }),
    addDomain: useMutation({ mutationFn: (host: string) => addPlatformTenantDomain(id, host), onSuccess: aposMudar }),
    removeDomain: useMutation({ mutationFn: (host: string) => removePlatformTenantDomain(id, host), onSuccess: aposMudar }),
  }
}
export function useReviewQueueQuery() {
  return useQuery({ queryKey: REVIEW_QUEUE_KEY, queryFn: getReviewQueue })
}
/**
 * As decisões da fila, como opções puras (o hook só as entrega ao useMutation; os testes as rodam sem React).
 * Decidido, a fila e a contagem "em análise" dos polos recarregam. Aprovar com o curso mudado (409 COURSE_CHANGED)
 * recarrega a fila para o revisor conferir o que mudou, e o erro segue para a tela mostrar a mensagem do servidor. Os
 * 400 (COURSE_WITHOUT_LESSONS, INVALID_TRANSITION) não recarregam sozinhos: o curso que saiu da análise sumiria da fila
 * junto com a explicação.
 */
export function reviewMutationOptions(qc: QueryClient) {
  const recarregarFila = () => qc.invalidateQueries({ queryKey: REVIEW_QUEUE_KEY })
  const aposDecidir = () => {
    void recarregarFila()
    void qc.invalidateQueries({ queryKey: PLATFORM_TENANTS_KEY })
  }
  return {
    approve: {
      mutationFn: (v: { courseId: string; fingerprint: string }) => approveCourse(v.courseId, v.fingerprint),
      onSuccess: aposDecidir,
      onError: (error: Error) => {
        if (apiErrorCode(error) === 'COURSE_CHANGED') void recarregarFila()
      },
    },
    giveBack: {
      mutationFn: (v: { courseId: string; note: string }) => returnCourse(v.courseId, v.note),
      onSuccess: aposDecidir,
    },
  }
}
export function useReviewMutations() {
  const o = reviewMutationOptions(useQueryClient())
  return { approve: useMutation(o.approve), giveBack: useMutation(o.giveBack) }
}
/**
 * Tirar do ar, como opções puras (como as da fila). A lista de cursos recarrega (a tela espera por ela para fechar o
 * formulário), e a lista de polos e o detalhe de cada polo também: "Publicados" mostra a contagem que acabou de mudar.
 */
export function takedownMutationOptions(qc: QueryClient) {
  return {
    mutationFn: (v: { courseId: string; note: string }) => takedownCourse(v.courseId, v.note),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PLATFORM_TENANTS_KEY })
      void qc.invalidateQueries({ queryKey: PLATFORM_TENANT_DETAILS_KEY })
      return qc.invalidateQueries({ queryKey: ADMIN_COURSES_KEY })
    },
  }
}
export function useTakedownCourseMutation() {
  return useMutation(takedownMutationOptions(useQueryClient()))
}
export function usePlatformLogsQuery() {
  return useQuery({ queryKey: PLATFORM_LOGS_KEY, queryFn: getPlatformLogs })
}
