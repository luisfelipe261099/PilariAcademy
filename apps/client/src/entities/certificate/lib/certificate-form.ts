/**
 * Regras do formulário de emissão do certificado. Espelham a validação do servidor
 * (`requireStudentName`): se divergirem, o botão habilita um envio que volta 400.
 */

/** Nome aceito para ir impresso no documento. E-mail nunca é nome. */
export function isValidFullName(nome: string): boolean {
  const limpo = nome.trim().replace(/\s+/g, ' ')
  return limpo.length >= 3 && !limpo.includes('@')
}

/**
 * O download usa `responseType: 'blob'`, então o corpo de ERRO também chega como Blob
 * e a mensagem do servidor fica ilegível — a tela mostrava "erro" genérico no lugar de
 * "informe seu nome completo". Aqui o Blob é lido e a mensagem real é extraída.
 */
export async function blobErrorMessage(err: unknown): Promise<string | null> {
  const data = (err as { response?: { data?: unknown } })?.response?.data
  if (!(data instanceof Blob)) return null
  try {
    const parsed = JSON.parse(await data.text()) as { message?: string | string[] }
    const msg = Array.isArray(parsed.message) ? parsed.message.join(', ') : parsed.message
    return typeof msg === 'string' && msg.trim() ? msg : null
  } catch {
    return null
  }
}
