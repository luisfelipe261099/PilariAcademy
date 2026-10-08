import { httpClient } from '@/shared/api/http-client'
import type { EditableProfile, MyCertificate, MyOrder } from '@pilari/types'
import { blobErrorMessage } from '@/entities/certificate/lib/certificate-form'

export async function getMyProfile(): Promise<EditableProfile> {
  const { data } = await httpClient.get<EditableProfile>('/auth/profile')
  return data
}

/** CPF só é aceito quando ainda está vazio no cadastro — o servidor ignora o resto. */
export async function updateMyProfile(patch: { displayName?: string; cpf?: string }): Promise<EditableProfile> {
  const { data } = await httpClient.patch<EditableProfile>('/auth/profile', patch)
  return data
}

export async function listMyOrders(): Promise<MyOrder[]> {
  const { data } = await httpClient.get<MyOrder[]>('/me/orders')
  return data
}

export async function listMyCertificates(): Promise<MyCertificate[]> {
  const { data } = await httpClient.get<MyCertificate[]>('/me/certificates')
  return data
}

/**
 * Baixa um PDF autenticado (carnê). O caminho vem do servidor SEM o prefixo /api e só
 * funciona por aqui: num `<a href>` não iria o header de autorização.
 */
/** Dispara o download do blob no navegador. */
function baixarBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Sem revogar, cada download deixa o blob inteiro preso na memória da aba.
  URL.revokeObjectURL(url)
}

/**
 * Igual ao downloadPdfAuth, mas por POST — para ações que EMITEM algo, e não só leem.
 * Um GET pode ser pré-buscado pelo navegador, e emitir certificado por engano não é opção.
 */
export async function downloadPdfPost(path: string, filename: string): Promise<void> {
  let res
  try {
    res = await httpClient.post(path, {}, { responseType: 'blob' })
  } catch (err) {
    const msg = await blobErrorMessage(err)
    throw msg ? new Error(msg) : err
  }
  baixarBlob(res.data as Blob, filename)
}

export async function downloadPdfAuth(path: string, filename: string): Promise<void> {
  let res
  try {
    res = await httpClient.get(path, { responseType: 'blob' })
  } catch (err) {
    // Erro numa resposta blob chega como Blob e a mensagem do servidor fica ilegível.
    const msg = await blobErrorMessage(err)
    throw msg ? new Error(msg) : err
  }
  baixarBlob(res.data as Blob, filename)
}
