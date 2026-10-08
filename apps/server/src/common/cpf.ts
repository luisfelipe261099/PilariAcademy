/** Só os dígitos de um CPF digitado com ou sem máscara. */
export function onlyDigits(s?: string | null): string {
  return (s ?? '').replace(/\D/g, '')
}

/**
 * Valida os dois dígitos verificadores do CPF. Sequências de um dígito só
 * ("111.111.111-11") passam na conta e são recusadas de propósito: nunca são um CPF real.
 */
export function isValidCpf(value: string): boolean {
  const d = onlyDigits(value)
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  const dv = (len: number): number => {
    let sum = 0
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i)
    const rest = (sum * 10) % 11
    return rest === 10 ? 0 : rest
  }
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10])
}

/**
 * Máscara do CPF: a MESMA do documento público do certificado (certificate.service). Nenhum dígito aparece; CPF fora do
 * formato não vira máscara (devolve vazio). O painel do polo a usa para o CPF de pessoa compartilhada.
 */
export function maskCpf(s?: string | null): string {
  return onlyDigits(s).length === 11 ? '***.***.***-**' : ''
}
