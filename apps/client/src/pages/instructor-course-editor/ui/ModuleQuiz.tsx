import { useState } from 'react'
import { Check, ChevronDown, ChevronRight, ClipboardList, Plus, Scale, Trash2, X } from 'lucide-react'
import type { AuthoringQuestion } from '@pilari/types'
import {
  useCreateQuestionMutation, useModuleQuestionsQuery, useRemoveQuestionMutation, useUpdateQuestionMutation,
} from '@/entities/quiz'

/** Formulário de nova questão (enunciado + alternativas + marca a correta + peso). */
function NewQuestion({ moduleId }: { moduleId: string }) {
  const [prompt, setPrompt] = useState('')
  const [options, setOptions] = useState<string[]>(['', ''])
  const [correctIndex, setCorrectIndex] = useState(0)
  const [points, setPoints] = useState('2')
  const [error, setError] = useState('')
  const createMut = useCreateQuestionMutation(moduleId)

  function reset() {
    setPrompt('')
    setOptions(['', ''])
    setCorrectIndex(0)
    setPoints('2')
    setError('')
  }

  function setOption(i: number, value: string) {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? value : o)))
  }
  function addOption() {
    setOptions((prev) => [...prev, ''])
  }
  function removeOption(i: number) {
    setOptions((prev) => prev.filter((_, idx) => idx !== i))
    setCorrectIndex((ci) => (ci === i ? 0 : ci > i ? ci - 1 : ci))
  }

  function submit() {
    // Mantém só alternativas preenchidas e recalcula o índice da correta após o filtro.
    const entries = options.map((text, i) => ({ text: text.trim(), correct: i === correctIndex }))
    const kept = entries.filter((e) => e.text)
    if (!prompt.trim() || kept.length < 2) {
      setError('Preencha o enunciado e ao menos 2 alternativas.')
      return
    }
    const ci = Math.max(0, kept.findIndex((e) => e.correct))
    const pts = Number(points.replace(',', '.')) || 0
    createMut.mutate(
      { prompt: prompt.trim(), options: kept.map((e) => e.text), correctIndex: ci, points: pts },
      { onSuccess: reset, onError: () => setError('Erro ao salvar a questão.') }
    )
  }

  return (
    <div className="mt-3 rounded-xl border border-dashed border-brand/40 bg-card p-3">
      <p className="mb-2 text-sm font-bold text-ink">Nova questão</p>
      <input
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Enunciado da questão (ex.: O que é overfitting?)"
        className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-foreground"
      />
      <p className="mt-3 text-xs font-bold uppercase tracking-wide text-muted">Alternativas — marque a correta</p>
      <ul className="mt-1 flex flex-col gap-2">
        {options.map((opt, i) => (
          <li key={i} className="flex items-center gap-2">
            <input
              type="radio"
              name={`correct-${moduleId}`}
              checked={correctIndex === i}
              onChange={() => setCorrectIndex(i)}
              aria-label={`Marcar alternativa ${i + 1} como correta`}
              className="size-4 shrink-0 cursor-pointer accent-brand"
            />
            <input
              value={opt}
              onChange={(e) => setOption(i, e.target.value)}
              placeholder={`Alternativa ${i + 1}`}
              className={'flex-1 rounded-lg border bg-bg px-3 py-1.5 text-sm text-foreground ' + (correctIndex === i ? 'border-accent' : 'border-border')}
            />
            {options.length > 2 && (
              <button type="button" onClick={() => removeOption(i)} className="cursor-pointer text-muted hover:text-red-500" aria-label="Remover alternativa">
                <X className="size-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      <button type="button" onClick={addOption} className="mt-2 cursor-pointer text-xs font-medium text-accent hover:underline">+ adicionar alternativa</button>

      <label className="mt-3 flex items-center gap-2 text-sm text-ink">
        <Scale className="size-4 shrink-0 text-brand" aria-hidden="true" />
        Peso (pontos):
        <input
          type="number"
          min={0}
          max={10}
          step={0.5}
          value={points}
          onChange={(e) => setPoints(e.target.value)}
          className="w-20 rounded-lg border border-border bg-bg px-2 py-1 text-sm text-foreground"
        />
      </label>

      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
      <button
        type="button"
        onClick={submit}
        disabled={createMut.isPending}
        className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-full bg-brand px-4 py-1.5 text-sm font-bold text-white hover:bg-brand-dark disabled:opacity-60"
      >
        <Plus className="size-4" /> {createMut.isPending ? 'Salvando…' : 'Adicionar questão'}
      </button>
    </div>
  )
}

/** Editor inline do peso de uma questão; salva no blur. */
function QuestionPoints({ moduleId, question }: { moduleId: string; question: AuthoringQuestion }) {
  const updateMut = useUpdateQuestionMutation(moduleId)
  function commit(raw: string) {
    const pts = Number(raw.replace(',', '.'))
    if (Number.isFinite(pts) && pts !== question.points) updateMut.mutate({ id: question.id, patch: { points: pts } })
  }
  return (
    <label className="flex shrink-0 items-center gap-1 text-xs text-muted">
      <Scale className="size-3.5" aria-hidden="true" />
      <input
        type="number"
        min={0}
        max={10}
        step={0.5}
        defaultValue={question.points}
        onBlur={(e) => commit(e.target.value)}
        className="w-16 rounded-md border border-border bg-bg px-1.5 py-0.5 text-right text-xs text-foreground"
        aria-label="Peso da questão"
      />
      pts
    </label>
  )
}

/** Seção "Prova do módulo" dentro do card de módulo — sempre mostra a contagem de questões. */
export function ModuleQuiz({ moduleId }: { moduleId: string }) {
  const [open, setOpen] = useState(false)
  const questionsQuery = useModuleQuestionsQuery(moduleId)
  const removeMut = useRemoveQuestionMutation(moduleId)
  const updateMut = useUpdateQuestionMutation(moduleId)
  const questions = questionsQuery.data ?? []
  const count = questions.length
  const sum = questions.reduce((s, q) => s + q.points, 0)
  const sumOk = Math.abs(sum - 10) < 0.001

  function distributeEvenly() {
    if (count === 0) return
    const each = Math.round((10 / count) * 100) / 100
    for (const q of questions) {
      if (q.points !== each) updateMut.mutate({ id: q.id, patch: { points: each } })
    }
  }

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-brand/30 bg-brand-soft/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer flex-col gap-1.5 px-3 py-2.5 text-left sm:flex-row sm:items-center sm:gap-2"
      >
        <span className="flex items-center gap-2">
          {open ? <ChevronDown className="size-4 shrink-0 text-brand" /> : <ChevronRight className="size-4 shrink-0 text-brand" />}
          <ClipboardList className="size-4 shrink-0 text-brand" aria-hidden="true" />
          <span className="font-bold whitespace-nowrap text-ink">Prova do módulo</span>
        </span>
        <span className="flex items-center gap-2 sm:flex-1">
          <span className={'shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold ' + (count > 0 ? 'bg-brand text-white' : 'bg-card text-muted')}>
            {count > 0 ? `${count} ${count === 1 ? 'questão' : 'questões'}` : 'sem questões'}
          </span>
          <span className="whitespace-nowrap text-xs font-bold text-brand sm:ml-auto">{open ? 'fechar' : 'gerenciar prova'}</span>
        </span>
      </button>

      {open && (
        <div className="border-t border-brand/20 px-3 py-3">
          <p className="mb-3 text-xs text-muted">
            Questões de múltipla escolha. Os pesos devem somar <strong>10</strong>; a nota do aluno é a soma dos pontos das questões
            certas (0–10). Precisa de <strong>7,0</strong> para passar no módulo. Ser aprovado em <strong>todas</strong> as provas do
            curso é exigido para o certificado. Módulo sem questões não bloqueia o certificado.
          </p>

          {count > 0 && (
            <div className={'mb-3 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm ' + (sumOk ? 'border-accent/40 bg-accent/5 text-accent' : 'border-amber-400/50 bg-amber-50 text-amber-700')}>
              <span className="font-bold">Soma dos pesos: {sum.toLocaleString('pt-BR')} / 10</span>
              {!sumOk && <span className="text-xs">Ajuste para somar 10.</span>}
              <button type="button" onClick={distributeEvenly} className="ml-auto cursor-pointer rounded-full border border-current px-3 py-0.5 text-xs font-bold">
                Distribuir 10 igualmente
              </button>
            </div>
          )}

          {questionsQuery.isLoading && <p className="text-sm text-muted">Carregando questões…</p>}
          {questionsQuery.isError && <p className="text-sm text-red-500">Não foi possível carregar as questões.</p>}

          <ol className="flex flex-col gap-2">
            {questions.map((q, qi) => (
              <li key={q.id} className="rounded-xl border border-border bg-card p-3">
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <p className="text-sm font-medium text-ink">{qi + 1}. {q.prompt}</p>
                  <div className="flex shrink-0 items-center gap-2">
                    <QuestionPoints moduleId={moduleId} question={q} />
                    <button type="button" onClick={() => removeMut.mutate(q.id)} className="cursor-pointer text-muted hover:text-red-500" aria-label="Excluir questão">
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
                <ul className="mt-1 flex flex-col gap-0.5 pl-1">
                  {q.options.map((o, oi) => (
                    <li key={oi} className={'flex items-center gap-1.5 text-sm ' + (oi === q.correctIndex ? 'font-bold text-accent' : 'text-muted')}>
                      {oi === q.correctIndex ? <Check className="size-3.5 shrink-0" aria-label="Correta" /> : <span className="inline-block size-3.5 shrink-0" />}
                      {o}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          {!questionsQuery.isLoading && count === 0 && (
            <p className="rounded-lg border border-dashed border-border bg-card p-3 text-sm text-muted">
              Nenhuma questão ainda. Adicione a primeira abaixo para este módulo virar uma prova. 👇
            </p>
          )}

          <NewQuestion moduleId={moduleId} />
        </div>
      )}
    </div>
  )
}
