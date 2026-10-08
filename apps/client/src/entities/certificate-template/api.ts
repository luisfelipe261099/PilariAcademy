import type { CertificateTemplateDetail, CertificateTemplateSummary, PlatformCourseRow } from '@pilari/types'
import { httpClient } from '@/shared/api/http-client'

const BASE = '/admin/certificate-template'

export async function listCertificateTemplates(): Promise<CertificateTemplateSummary[]> {
  const { data } = await httpClient.get<{ templates: CertificateTemplateSummary[] }>(BASE)
  return data.templates
}

export async function getCertificateTemplate(id: string): Promise<CertificateTemplateDetail> {
  const { data } = await httpClient.get<CertificateTemplateDetail>(`${BASE}/${id}`)
  return data
}

/** HTML de partida para um template novo (o do padrão, ou o de fábrica). */
export async function getStarterHtml(): Promise<string> {
  const { data } = await httpClient.get<{ html: string }>(`${BASE}/novo`)
  return data.html
}

export async function createCertificateTemplate(name: string, html: string): Promise<string> {
  const { data } = await httpClient.post<{ id: string }>(BASE, { name, html })
  return data.id
}

export async function updateCertificateTemplate(
  id: string,
  patch: { name?: string; html?: string }
): Promise<void> {
  await httpClient.put(`${BASE}/${id}`, patch)
}

export async function setDefaultCertificateTemplate(id: string): Promise<void> {
  await httpClient.put(`${BASE}/${id}/padrao`, {})
}

export async function deleteCertificateTemplate(id: string): Promise<{ cursosLiberados: number }> {
  const { data } = await httpClient.delete<{ cursosLiberados: number }>(`${BASE}/${id}`)
  return data
}

export async function listTemplateCourses(id: string): Promise<{ id: string; title: string }[]> {
  const { data } = await httpClient.get<{ courses: { id: string; title: string }[] }>(`${BASE}/${id}/cursos`)
  return data.courses
}

/**
 * Cursos de TODOS os polos (rota da plataforma), com o polo de cada um e o modelo vinculado. O modelo de certificado é
 * da rede inteira: a lista do admin (`/admin/courses`) só traria os cursos do polo do endereço. Busca por título.
 */
export async function listPlatformCourses(q: string): Promise<PlatformCourseRow[]> {
  const { data } = await httpClient.get<{ courses: PlatformCourseRow[] }>('/platform/courses', { params: q ? { q } : undefined })
  return data.courses
}

/** `templateId` nulo devolve os cursos ao padrão. */
export async function assignCertificateTemplate(
  templateId: string | null,
  courseIds: string[]
): Promise<{ atualizados: number }> {
  const { data } = await httpClient.post<{ atualizados: number }>(`${BASE}/vincular`, { templateId, courseIds })
  return data
}

/**
 * Renderiza o preview (PDF) e devolve um object URL para exibir num <iframe>.
 * Com `courseId`, usa o coordenador REAL daquele curso — é o único jeito de conferir
 * a 2ª assinatura antes de salvar.
 */
export async function previewCertificateTemplate(html: string, courseId?: string): Promise<string> {
  try {
    const res = await httpClient.post(
      `${BASE}/preview`,
      { html },
      { responseType: 'blob', params: courseId ? { courseId } : undefined }
    )
    return URL.createObjectURL(res.data as Blob)
  } catch (err) {
    // Com responseType 'blob', a resposta de erro também vem como Blob → extrai a mensagem.
    const data = (err as { response?: { data?: unknown } }).response?.data
    if (data instanceof Blob) {
      const text = await data.text()
      let message = text
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? text
      } catch {
        /* corpo não-JSON: usa o texto cru */
      }
      throw new Error(message)
    }
    throw err
  }
}
