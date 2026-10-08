import { GradesReport, useCourseGradesQuery } from '@/entities/quiz'

/** Boletim do aluno no curso: nota (0–10) por módulo com prova + nota final. */
export function GradesTab({ slug }: { slug: string }) {
  const { data, isLoading, isError } = useCourseGradesQuery(slug)

  if (isLoading) return <p className="text-muted">Carregando boletim…</p>
  if (isError || !data) return <p className="text-muted">Não foi possível carregar o boletim.</p>

  return (
    <div>
      <GradesReport grades={data} />
      <p className="mt-2 text-xs text-muted">Você precisa de nota <strong>7,0</strong> em cada módulo com prova para ser aprovado no curso.</p>
    </div>
  )
}
