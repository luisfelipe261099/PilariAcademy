/**
 * O `code` estável do corpo de um erro da API (`COURSE_CHANGED`, `TENANT_NOT_FOUND`...), ou null quando a resposta não
 * traz um (ex.: o 409 do endereço repetido) ou nem houve resposta (erro de rede).
 */
export function apiErrorCode(error: unknown): string | null {
  const code = (error as { response?: { data?: { code?: unknown } } } | null | undefined)?.response?.data?.code
  return typeof code === 'string' ? code : null
}
