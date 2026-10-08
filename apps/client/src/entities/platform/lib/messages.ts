import type { TenantAdminResult } from '@pilari/types'
import { apiErrorCode } from './api-error'

/**
 * Mesma forma que o servidor aceita (`TENANT_SLUG_PATTERN` e a regra dos dois hífens); nomes reservados o servidor
 * recusa com a mensagem dele.
 */
export function tenantSlugError(slug: string): string | null {
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) return 'Use de 3 a 40 letras minúsculas, números e hífen, sem hífen no começo ou no fim.'
  if (slug.includes('--')) return 'Não use dois hífens seguidos.'
  return null
}

/**
 * O que dizer depois de vincular um admin. O link vem primeiro: o servidor o envia à conta nova e também a quem tem
 * conta mas nunca entrou (existingAccount e resetEmailSent juntos). Só sem link, e com conta antiga, vale "senha de sempre".
 */
export function tenantAdminMessage(r: TenantAdminResult): string {
  if (r.resetEmailSent) return `Enviamos para ${r.email} o link para definir a senha.`
  if (r.existingAccount) return `${r.email} já tinha conta na rede e entra com a senha de sempre.`
  return `A conta de ${r.email} foi criada, mas o link de senha não saiu. Envie pela lista de usuários do polo, em Resetar senha.`
}

/**
 * O aviso do 409 `COURSE_CHANGED` na fila: o curso mudou desde que ela foi carregada. A fila já recarregou sozinha quando
 * o erro chega, então o aviso manda conferir os dados novos e aprovar de novo, no lugar do "Recarregue e confira" do
 * servidor. null para qualquer outro erro: a tela mostra a mensagem do servidor.
 */
export function courseChangedNotice(error: unknown): string | null {
  return apiErrorCode(error) === 'COURSE_CHANGED' ? 'A fila foi atualizada: confira os dados e aprove de novo.' : null
}
