import { Award, CheckCircle2, Clock, XCircle } from 'lucide-react'
import type { CourseGrades } from '@pilari/types'

const fmt = (g: number) => g.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** Boletim (nota 0–10 por módulo com prova + nota final). Componente puro de exibição. */
export function GradesReport({ grades }: { grades: CourseGrades }) {
  const graded = grades.modules.filter((m) => m.hasQuiz)
  if (graded.length === 0) return <p className="text-sm text-muted">Este curso não tem provas.</p>

  return (
    <div>
      <ul className="flex flex-col gap-2">
        {graded.map((m) => (
          <li key={m.moduleId} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
            <span className="min-w-0 truncate font-medium text-ink">{m.title}</span>
            <span className="flex shrink-0 items-center gap-3">
              <span className={'text-lg font-bold ' + (m.grade === null ? 'text-muted' : m.passed ? 'text-accent' : 'text-red-500')}>
                {m.grade === null ? '—' : fmt(m.grade)}
              </span>
              {m.grade === null ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-bold text-brand">
                  <Clock className="size-3" aria-hidden="true" /> não fez
                </span>
              ) : m.passed ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-bold text-accent">
                  <CheckCircle2 className="size-3" aria-hidden="true" /> aprovado
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-bold text-red-600">
                  <XCircle className="size-3" aria-hidden="true" /> reprovado
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>

      <div className={'mt-4 flex items-center justify-between gap-3 rounded-xl border p-4 ' + (grades.approved ? 'border-accent/40 bg-accent/5' : 'border-border bg-card')}>
        <span className="flex items-center gap-2 font-bold text-ink">
          <Award className="size-5 text-brand" aria-hidden="true" /> Nota final
        </span>
        <span className="flex items-center gap-3">
          <span className={'text-2xl font-bold ' + (grades.finalGrade === null ? 'text-muted' : grades.approved ? 'text-accent' : 'text-red-500')}>
            {grades.finalGrade === null ? '—' : fmt(grades.finalGrade)}
          </span>
          <span className={'rounded-full px-3 py-1 text-xs font-bold ' + (grades.approved ? 'bg-accent/10 text-accent' : 'bg-red-50 text-red-600')}>
            {grades.approved ? 'Aprovado no curso' : 'Em andamento'}
          </span>
        </span>
      </div>
    </div>
  )
}
