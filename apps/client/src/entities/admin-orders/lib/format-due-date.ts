/**
 * Formata uma data-pura (`YYYY-MM-DD`, sem hora) da forma brasileira.
 *
 * `orders.dueDate`/`order_installments.dueDate` só guardam a data, sem hora nem fuso.
 * Passar essa string direto por `new Date('2026-01-10')` faria o motor interpretar como
 * UTC-meia-noite, que em America/Sao_Paulo (UTC-3) vira o dia ANTERIOR na tela — um boleto
 * que vence dia 10 apareceria como vencendo dia 09 para o admin que lê a data pro aluno.
 * Como não há hora nenhuma pra preservar aqui, remontamos os pedaços direto no formato
 * brasileiro sem passar pelo parser de data em nenhum momento.
 */
export function formatDueDate(dueDate: string | null): string {
  if (!dueDate) return '—'
  const [y, m, d] = dueDate.split('-')
  if (!y || !m || !d) return dueDate
  return `${d}/${m}/${y.slice(2)}`
}
