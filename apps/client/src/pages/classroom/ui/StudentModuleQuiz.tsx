import { useState } from 'react'
import { CheckCircle2, ClipboardList, Lock, XCircle } from 'lucide-react'
import { useModuleQuizQuery, useSubmitQuizMutation } from '@/entities/quiz'
import { useTenant } from '@/entities/tenant'
import { quizLockedNotice } from '../lib/quiz-locked-notice'

/** Nota 0–100 → texto 0–10 no formato pt-BR (ex.: 80 → "8,0"). */
const nota = (score: number) => (score / 10).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** Prova do módulo na sala de aula. Não renderiza nada se o módulo não tem questões. */
export function StudentModuleQuiz({ moduleId, moduleTitle, onResult }: { moduleId: string; moduleTitle: string; onResult?: () => void }) {
  const quizQuery = useModuleQuizQuery(moduleId)
  const submitMut = useSubmitQuizMutation(moduleId)
  const { isMatriz } = useTenant()
  const [answers, setAnswers] = useState<Record<string, number>>({})

  const quiz = quizQuery.data
  if (quizQuery.isLoading) return <p className="text-muted">Carregando prova…</p>
  if (!quiz || quiz.questions.length === 0) return <p className="text-muted">Esta prova ainda não tem questões.</p>

  const result = submitMut.data
  const locked = quiz.locked
  const allAnswered = quiz.questions.every((q) => answers[q.id] !== undefined)

  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-5">
      <h3 className="flex items-center gap-2 text-lg font-bold text-ink">
        <ClipboardList className="size-5 text-brand" aria-hidden="true" /> Prova — {moduleTitle}
      </h3>

      {quiz.passed ? (
        <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-bold text-accent">
          <CheckCircle2 className="size-4" aria-hidden="true" /> Aprovado{quiz.bestScore !== null ? ` — melhor nota ${nota(quiz.bestScore)}` : ''}
        </p>
      ) : quiz.bestScore !== null ? (
        <p className="mt-1 text-sm text-muted">Melhor nota: <strong>{nota(quiz.bestScore)}</strong> — você precisa de <strong>7,0</strong> para ser aprovado.</p>
      ) : (
        <p className="mt-1 text-sm text-muted">Acerte ao menos <strong>7,0</strong> para ser aprovado.</p>
      )}

      <p className="mt-1 text-xs text-muted">Tentativas: {quiz.attemptsUsed} de {quiz.maxAttempts}</p>

      {locked && !quiz.passed && (
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-600">
          <Lock className="size-4" aria-hidden="true" /> {quizLockedNotice(isMatriz)}
        </p>
      )}

      <ol className="mt-4 flex flex-col gap-5">
        {quiz.questions.map((q, qi) => (
          <li key={q.id}>
            <p className="font-medium text-ink">
              {qi + 1}. {q.prompt} <span className="text-xs font-normal text-muted">(vale {q.points.toLocaleString('pt-BR')} pts)</span>
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {q.options.map((opt, oi) => (
                <li key={oi}>
                  <label className={'flex items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-foreground ' + (locked ? 'opacity-60' : 'cursor-pointer hover:bg-brand-soft')}>
                    <input
                      type="radio"
                      name={`q-${q.id}`}
                      disabled={locked}
                      checked={answers[q.id] === oi}
                      onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: oi }))}
                    />
                    {opt}
                  </label>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      {!locked && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => submitMut.mutate(answers, { onSuccess: () => onResult?.() })}
            disabled={!allAnswered || submitMut.isPending}
            className="cursor-pointer rounded-full bg-brand px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-dark disabled:cursor-default disabled:opacity-60"
          >
            {submitMut.isPending ? 'Enviando…' : quiz.passed ? 'Refazer prova' : 'Enviar prova'}
          </button>
          {!allAnswered && <span className="text-xs text-muted">Responda todas as questões.</span>}
        </div>
      )}

      {result && (
        <p className={'mt-3 inline-flex items-center gap-1.5 text-sm font-bold ' + (result.passed ? 'text-accent' : 'text-red-500')}>
          {result.passed ? <CheckCircle2 className="size-4" aria-hidden="true" /> : <XCircle className="size-4" aria-hidden="true" />}
          {result.passed ? `Aprovado! Nota ${nota(result.score)}` : `Nota ${nota(result.score)} — não aprovado.${result.locked ? '' : ' Tente novamente.'}`}
        </p>
      )}
    </section>
  )
}
