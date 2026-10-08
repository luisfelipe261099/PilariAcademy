import { httpClient } from '@/shared/api/http-client'
import type { CertificateVerification, OrderSettlement } from '@pilari/types'
import { blobErrorMessage } from './lib/certificate-form'

/**
 * Baixa um PDF autenticado (blob) e dispara o download no navegador. Compartilhado pelo
 * certificado e pelo carnê: os dois são endpoints protegidos que só respondem pela
 * instância axios com o header de auth, nunca por um `<a href>` direto.
 */
async function downloadPdf(url: string, fileName: string, params?: Record<string, string>): Promise<void> {
  let res
  try {
    res = await httpClient.get(url, { responseType: 'blob', params })
  } catch (err) {
    // Sem isto, a razão da recusa (nome/CPF ausente, prova pendente, carnê em aberto)
    // morre dentro do Blob.
    const msg = await blobErrorMessage(err)
    throw msg ? new Error(msg) : err
  }
  const blobUrl = URL.createObjectURL(res.data as Blob)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(blobUrl)
}

/** Baixa o PDF do certificado (com o token de auth) e dispara o download. */
export async function downloadCertificate(slug: string, cpf?: string, nome?: string): Promise<void> {
  const params: Record<string, string> = {}
  if (cpf) params.cpf = cpf
  if (nome) params.nome = nome
  await downloadPdf(`/me/courses/${slug}/certificate`, 'certificado.pdf', params)
}

/** Estado de quitação do pedido do curso (para a tela de certificado bloqueado). */
export async function getSettlement(slug: string): Promise<OrderSettlement> {
  const { data } = await httpClient.get<OrderSettlement>(`/me/courses/${slug}/certificate/status`)
  return data
}

/**
 * Baixa o carnê (PDF com todos os boletos) do pedido. `carneUrl` vem pronto do servidor
 * (`OrderSettlement.carneUrl`, ex.: `/me/orders/:id/carne`) — SEM prefixo `/api`, porque
 * `httpClient` já aplica o baseURL, e só funciona autenticado (nunca em `<a href>`).
 */
export async function downloadCarne(carneUrl: string): Promise<void> {
  await downloadPdf(carneUrl, 'carne.pdf')
}

export async function verifyCertificate(code: string): Promise<CertificateVerification> {
  const { data } = await httpClient.get<CertificateVerification>(`/certificates/${code}/verify`)
  return data
}

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

/** URL pública do PDF do certificado (para <iframe> e link de download). */
export function certificateDocumentUrl(code: string, download = false): string {
  return `${API_BASE}/certificates/${code}/document${download ? '?download=1' : ''}`
}
