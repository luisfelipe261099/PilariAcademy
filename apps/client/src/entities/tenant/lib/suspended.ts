import type { PublicTenant } from '@pilari/types'

/** Textos do polo suspenso: catálogo e página de curso fecham (403 TENANT_SUSPENDED), sala de aula e conta seguem. */
export interface SuspendedCopy {
  banner: string
  catalog: string
  courseTitle: string
  courseText: string
}

/** `null` quando o polo está ativo (a matriz nunca é suspensa). */
export function suspendedCopy(tenant: Pick<PublicTenant, 'name' | 'status'>): SuspendedCopy | null {
  if (tenant.status !== 'suspended') return null
  return {
    banner: `As matrículas de ${tenant.name} estão suspensas no momento. Quem já é aluno continua com acesso aos cursos em Minha conta.`,
    catalog: `O catálogo de ${tenant.name} está indisponível no momento.`,
    courseTitle: 'Curso indisponível',
    courseText: 'As matrículas deste polo estão suspensas no momento. Se você já é aluno, acesse seus cursos em Minha conta.',
  }
}
