/**
 * Status do Asaas que significam "pago". Vive fora dos services porque webhook e parcelas
 * precisam da MESMA definição: duplicar a lista fazia com que acrescentar um status novo
 * (RECEIVED_IN_CASH, no passado) liberasse o pedido sem marcar a parcela, ou vice-versa.
 */
export const PAID_STATUSES: ReadonlySet<string> = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'])
