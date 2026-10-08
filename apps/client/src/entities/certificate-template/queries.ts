import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  assignCertificateTemplate,
  createCertificateTemplate,
  deleteCertificateTemplate,
  getCertificateTemplate,
  getStarterHtml,
  listCertificateTemplates,
  listPlatformCourses,
  listTemplateCourses,
  previewCertificateTemplate,
  setDefaultCertificateTemplate,
  updateCertificateTemplate,
} from './api'

const KEY = ['certificate-templates'] as const

export function useCertificateTemplatesQuery() {
  return useQuery({ queryKey: KEY, queryFn: listCertificateTemplates })
}

export function useCertificateTemplateQuery(id: string | null) {
  return useQuery({
    queryKey: [...KEY, id] as const,
    queryFn: () => getCertificateTemplate(id as string),
    enabled: id !== null,
  })
}

export function useStarterHtmlQuery(enabled: boolean) {
  return useQuery({ queryKey: [...KEY, 'novo'] as const, queryFn: getStarterHtml, enabled })
}

export function useTemplateCoursesQuery(id: string | null) {
  return useQuery({
    queryKey: [...KEY, id, 'cursos'] as const,
    queryFn: () => listTemplateCourses(id as string),
    enabled: id !== null,
  })
}

/**
 * Cursos de todos os polos para vincular a um modelo, com a busca `q` feita no servidor. A chave fica sob a raiz dos
 * modelos: vincular invalida a raiz, e a lista volta com o modelo novo de cada curso. Enquanto a busca nova carrega, a
 * lista anterior continua na tela.
 */
export function usePlatformCoursesQuery(q: string) {
  return useQuery({
    queryKey: [...KEY, 'cursos-da-rede', q] as const,
    queryFn: () => listPlatformCourses(q),
    placeholderData: keepPreviousData,
  })
}

/**
 * Todas as mutações invalidam a chave RAIZ, e não só a do template mexido: a lista carrega
 * a contagem de cursos e a marca de padrão, então salvar um template muda a linha de
 * outro. Invalidar só o editado deixaria a lista mentindo.
 */
function useInvalidateAll() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: KEY })
}

export function useCreateTemplateMutation() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: ({ name, html }: { name: string; html: string }) => createCertificateTemplate(name, html),
    onSuccess: invalidate,
  })
}

export function useUpdateTemplateMutation() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string; name?: string; html?: string }) =>
      updateCertificateTemplate(id, patch),
    onSuccess: invalidate,
  })
}

export function useSetDefaultTemplateMutation() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: setDefaultCertificateTemplate, onSuccess: invalidate })
}

export function useDeleteTemplateMutation() {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn: deleteCertificateTemplate, onSuccess: invalidate })
}

export function useAssignTemplateMutation() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: ({ templateId, courseIds }: { templateId: string | null; courseIds: string[] }) =>
      assignCertificateTemplate(templateId, courseIds),
    onSuccess: invalidate,
  })
}

export function usePreviewCertificateTemplateMutation() {
  return useMutation({
    mutationFn: ({ html, courseId }: { html: string; courseId?: string }) =>
      previewCertificateTemplate(html, courseId),
  })
}
