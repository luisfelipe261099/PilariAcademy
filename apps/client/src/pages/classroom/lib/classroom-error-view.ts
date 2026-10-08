/** O que a sala de aula mostra quando a consulta falha. */
export interface ClassroomErrorView {
  title: string
  message: string
  link: { to: string; label: string }
}

/** "Meus cursos" do aluno (o painel). */
const MEUS_CURSOS = '/dashboard'
const INDISPONIVEL_PADRAO = 'Este curso está indisponível no momento.'

/**
 * Decide a tela de erro da sala de aula. O servidor responde 403 `COURSE_UNAVAILABLE` ao aluno matriculado num curso
 * que saiu do ar: ele já tem o curso, então "você precisa ter este curso" e o link para a página de venda (que também
 * está fora do ar) não servem. Mostra a mensagem do servidor, que nos polos manda falar com o polo, e leva aos cursos
 * do aluno. Qualquer outro erro mantém a tela de sempre.
 */
export function classroomErrorView(error: unknown, slug: string): ClassroomErrorView {
  const response = (error as { response?: { status?: unknown; data?: unknown } } | null | undefined)?.response
  const data = (response?.data ?? null) as { code?: unknown; message?: unknown } | null
  if (response?.status === 403 && data?.code === 'COURSE_UNAVAILABLE') {
    const message = typeof data.message === 'string' && data.message.trim() ? data.message : INDISPONIVEL_PADRAO
    return { title: 'Curso indisponível', message, link: { to: MEUS_CURSOS, label: 'Ver meus cursos' } }
  }
  return {
    title: 'Acesso indisponível',
    message: 'Você precisa ter este curso para acessar a sala de aula.',
    link: { to: `/curso/${slug}`, label: 'Ver o curso' },
  }
}
