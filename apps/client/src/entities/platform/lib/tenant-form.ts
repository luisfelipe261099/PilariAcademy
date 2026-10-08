import type { UpdateTenantInput } from '@pilari/types'

/** Mesma regra do servidor: 2 a 160 caracteres, contados depois de aparar. */
export function tenantNameError(name: string): string | null {
  const n = name.trim().length
  return n >= 2 && n <= 160 ? null : 'Informe o nome do polo (2 a 160 caracteres).'
}

/**
 * O PATCH que renomeia o polo, ou null quando não há o que mandar: campo que ninguém tocou (`typed` null), nome igual ao
 * salvo ou inválido. O servidor responde 400 "Nada para alterar." a um PATCH sem campos, então a tela não manda vazio.
 */
export function tenantNamePatch(saved: string, typed: string | null): UpdateTenantInput | null {
  if (typed === null) return null
  const name = typed.trim()
  if (name === saved.trim() || tenantNameError(name) !== null) return null
  return { name }
}
