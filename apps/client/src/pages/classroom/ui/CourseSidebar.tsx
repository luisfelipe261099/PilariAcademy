import { useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronRight, ClipboardList, Circle, FileText, Lock, PlayCircle } from 'lucide-react'
import type { ClassroomLesson, ClassroomModule } from '@pilari/types'

function fmtShortDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function fmtTotal(sec: number): string {
  const m = Math.round(sec / 60)
  if (m < 60) return `${m}min`
  return `${Math.floor(m / 60)}h ${m % 60}min`
}
function fmtLesson(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}min${s ? ` ${s}s` : ''}` : `${s}s`
}

function Section({ module, currentId, activeQuizModuleId, defaultOpen, onSelect, onSelectQuiz, onToggleComplete }: {
  module: ClassroomModule
  currentId: string | null
  activeQuizModuleId: string | null
  defaultOpen: boolean
  onSelect: (id: string) => void
  onSelectQuiz: (moduleId: string) => void
  onToggleComplete: (lesson: ClassroomLesson) => void
}) {
  const [open, setOpen] = useState(defaultOpen)
  const done = module.lessons.filter((l) => l.completed).length
  const total = module.lessons.length
  const dur = module.lessons.reduce((s, l) => s + l.durationSec, 0)

  return (
    <div className="border-b border-border last:border-b-0">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 bg-surface px-4 py-3 text-left">
        {open ? <ChevronDown className="size-4 shrink-0 text-muted" /> : <ChevronRight className="size-4 shrink-0 text-muted" />}
        <span className="flex-1">
          <span className="block text-sm font-bold text-ink">{module.title}</span>
          <span className="block text-xs text-muted">{done}/{total} · {fmtTotal(dur)}</span>
          {module.locked && (
            <span className="mt-0.5 flex items-center gap-1 text-xs font-medium text-brand">
              <Lock className="size-3" aria-hidden="true" /> Abre em {fmtShortDate(module.availableAt)}
            </span>
          )}
        </span>
      </button>
      {open && (
        <ul>
          {module.lessons.map((lesson) => {
            const active = currentId === lesson.id
            const Icon = lesson.signedVideoUrl ? PlayCircle : FileText
            return (
              <li key={lesson.id}>
                <button
                  type="button"
                  onClick={() => onSelect(lesson.id)}
                  className={'flex w-full items-start gap-2 px-4 py-2 text-left text-sm transition-colors hover:bg-brand-soft ' + (active ? 'bg-brand-soft' : '')}
                >
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); onToggleComplete(lesson) }}
                    className="mt-0.5 shrink-0"
                    aria-label={lesson.completed ? 'Marcar como não concluída' : 'Marcar como concluída'}
                  >
                    {lesson.completed ? <CheckCircle2 className="size-4 text-accent" /> : <Circle className="size-4 text-muted" />}
                  </span>
                  <span className="flex-1">
                    <span className="block text-ink">{lesson.title}</span>
                    <span className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                      <Icon className="size-3" aria-hidden="true" /> {fmtLesson(lesson.durationSec)}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}

          {module.hasQuiz && (
            <li>
              <button
                type="button"
                onClick={() => onSelectQuiz(module.id)}
                className={'flex w-full items-start gap-2 px-4 py-2 text-left text-sm transition-colors hover:bg-brand-soft ' + (activeQuizModuleId === module.id ? 'bg-brand-soft' : '')}
              >
                <span className="mt-0.5 shrink-0">
                  {module.quizPassed ? <CheckCircle2 className="size-4 text-accent" /> : <Circle className="size-4 text-muted" />}
                </span>
                <span className="flex-1">
                  <span className="block font-medium text-ink">Prova do módulo</span>
                  <span className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                    <ClipboardList className="size-3" aria-hidden="true" /> {module.quizPassed ? 'aprovado' : 'avaliação'}
                  </span>
                </span>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

export function CourseSidebar({ modules, currentId, currentModuleId, activeQuizModuleId, onSelect, onSelectQuiz, onToggleComplete }: {
  modules: ClassroomModule[]
  currentId: string | null
  currentModuleId: string | null
  activeQuizModuleId: string | null
  onSelect: (id: string) => void
  onSelectQuiz: (moduleId: string) => void
  onToggleComplete: (lesson: ClassroomLesson) => void
}) {
  return (
    <aside className="h-fit overflow-hidden rounded-2xl border border-border bg-card">
      <h2 className="border-b border-border p-4 font-bold text-ink">Conteúdo do curso</h2>
      <div className="flex flex-col">
        {modules.map((module) => (
          <Section
            key={module.id}
            module={module}
            currentId={currentId}
            activeQuizModuleId={activeQuizModuleId}
            defaultOpen={module.id === currentModuleId}
            onSelect={onSelect}
            onSelectQuiz={onSelectQuiz}
            onToggleComplete={onToggleComplete}
          />
        ))}
      </div>
    </aside>
  )
}
