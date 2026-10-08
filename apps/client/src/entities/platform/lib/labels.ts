import type { PlatformAuditLog, ReviewQueueItem } from '@pilari/types'

/** Aviso da primeira aprovação: é ela que trava os dados do certificado (e congela a carga calculada). */
export const FIRST_APPROVAL_WARNING = 'Ao aprovar, título, carga horária, coordenador e assinatura ficam travados para o polo.'

/** A carga que o certificado vai imprimir: "40 h", ou "12 h (soma das aulas)" quando o polo não a definiu. */
export function workloadLabel(i: Pick<ReviewQueueItem, 'workloadHours' | 'workloadIsComputed'>): string {
  return i.workloadIsComputed ? `${i.workloadHours} h (soma das aulas)` : `${i.workloadHours} h`
}

/** De onde veio o registro do log da rede: o polo, ou a Plataforma quando a ação não é de nenhum polo. */
export function logOriginLabel(l: Pick<PlatformAuditLog, 'tenantId' | 'tenantName'>): string {
  if (l.tenantName) return l.tenantName
  return l.tenantId ? 'Polo removido' : 'Plataforma'
}
