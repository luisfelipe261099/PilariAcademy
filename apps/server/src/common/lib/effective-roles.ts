import { Role } from '@pilari/types'

const VALIDOS = new Set<Role>([Role.admin, Role.teacher, Role.student])

/** Papéis valendo no polo do endereço: os do vínculo, mais `admin` para a equipe da plataforma. */
export function effectiveRoles(memberRoles: readonly Role[], isPlatformAdmin: boolean): Role[] {
  const set = new Set<Role>(memberRoles.filter((r) => VALIDOS.has(r)))
  if (isPlatformAdmin) set.add(Role.admin)
  return [...set]
}

/**
 * Admin da plataforma EFETIVO: o sinal `users.is_platform_admin` OU o papel `admin` no vínculo da MATRIZ. A tela de
 * usuários da matriz continua sendo onde o Studio Pilari dá e tira esse poder, como antes dos polos: quem é admin da matriz
 * aprova cursos, abre o console e age como admin em qualquer polo. O sinal fica para a equipe que não é membro da matriz.
 * Toda checagem "é da plataforma?" passa por aqui (guard, sync, serialização e as regras sobre a conta de outra pessoa).
 */
export function isEffectivePlatformAdmin(flag: boolean | null | undefined, matrizRoles: readonly string[] | null | undefined): boolean {
  return !!flag || (matrizRoles ?? []).includes(Role.admin)
}
