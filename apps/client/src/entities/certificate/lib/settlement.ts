import type { OrderSettlement } from '@pilari/types'

/**
 * O que mostrar na sala de aula quando o certificado está preso pelo carnê (boleto
 * parcelado em até 5x) não quitado. `null` quando não há nada a avisar: carnê quitado,
 * pedido sem carnê (à vista/cartão), ou settlement ainda não carregado.
 *
 * Escopo restrito ao carnê de propósito: só ele tem um PDF do servidor para devolver
 * (`carneUrl`). Um boleto único (à vista) em aberto não tem endpoint de reemissão aqui —
 * o aluno já vê o motivo ao tentar baixar o certificado (403 do `issueOrGet`).
 */
export interface CarneBlockedInfo {
  message: string
  carneUrl: string
}

export function carneBlockedInfo(settlement: OrderSettlement | undefined): CarneBlockedInfo | null {
  if (!settlement || settlement.settled || !settlement.carneUrl) return null
  const faltam = settlement.totalCount - settlement.paidCount
  const message =
    faltam > 0
      ? `Certificado bloqueado: ${faltam === 1 ? 'falta' : 'faltam'} ${faltam} de ${settlement.totalCount} parcela${settlement.totalCount === 1 ? '' : 's'} do carnê para quitar.`
      : 'Certificado bloqueado: pagamento do carnê pendente.'
  return { message, carneUrl: settlement.carneUrl }
}
