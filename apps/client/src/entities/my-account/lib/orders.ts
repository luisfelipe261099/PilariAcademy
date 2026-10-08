import type { MyCertificate, MyOrder, OrderInstallment } from '@pilari/types'

/** Rótulo do status do pedido para o aluno (o do admin é técnico demais). */
export function orderStatusLabel(status: MyOrder['status']): string {
  switch (status) {
    case 'paid':
      return 'Pago'
    case 'pending':
      return 'Aguardando pagamento'
    case 'canceled':
      return 'Cancelado'
    default:
      return status
  }
}

export function installmentStatusLabel(status: OrderInstallment['status']): string {
  switch (status) {
    case 'paid':
      return 'Paga'
    case 'pending':
      return 'A vencer'
    case 'overdue':
      return 'Vencida'
    case 'refunded':
      return 'Estornada'
    default:
      return status
  }
}

export function paymentModeLabel(mode: MyOrder['paymentMode']): string {
  switch (mode) {
    case 'boleto_parcelado':
      return 'Carnê (boleto parcelado)'
    case 'cartao_parcelado':
      return 'Cartão parcelado'
    case 'avista':
      return 'À vista'
    default:
      // Pedidos anteriores à funcionalidade não têm modo gravado. Mostrar "—" é honesto;
      // inventar "À vista" afirmaria algo que não sabemos.
      return '—'
  }
}

/**
 * Mostrar o botão "Pagar" só faz sentido enquanto há o que pagar E existe para onde ir.
 * Pedido cancelado com link vivo no Asaas é o caso perigoso: sem o teste de status, o
 * aluno pagaria um boleto de uma compra que já não vale.
 */
export function canPay(order: MyOrder): boolean {
  return order.status === 'pending' && !!order.paymentUrl
}

/** Progresso do carnê. `null` quando o pedido não é carnê (não há parcelas nossas). */
export function carneProgress(order: MyOrder): { pagas: number; total: number; quitado: boolean } | null {
  if (order.installments.length === 0) return null
  const pagas = order.installments.filter((i) => i.status === 'paid').length
  return { pagas, total: order.installments.length, quitado: order.settledAt != null }
}

/**
 * Data-pura (`YYYY-MM-DD`) no formato brasileiro, sem passar pelo parser de datas:
 * `new Date('2026-01-10')` é lido como UTC e, em America/Sao_Paulo, mostraria o dia
 * ANTERIOR — um boleto que vence dia 10 apareceria como dia 09 para o aluno.
 */
export function formatDateOnly(value: string | null): string {
  if (!value) return '—'
  const [y, m, d] = value.slice(0, 10).split('-')
  if (!y || !m || !d) return value
  return `${d}/${m}/${y}`
}

/** Timestamp ISO (com hora) no formato brasileiro. Aqui o parser é seguro: há fuso na string. */
export function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const t = new Date(iso)
  return Number.isNaN(t.getTime()) ? '—' : t.toLocaleDateString('pt-BR')
}

/** Certificado revogado não deve oferecer download. */
export function canDownloadCertificate(c: MyCertificate): boolean {
  return c.status === 'issued'
}
