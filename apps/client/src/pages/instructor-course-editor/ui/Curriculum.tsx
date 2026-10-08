import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AlertCircle, CalendarClock, Download, GripVertical, Plus, Trash2, Check, FileText, Youtube } from 'lucide-react'
import type { AuthoringLesson, AuthoringModule } from '@pilari/types'
import { FileUploadButton } from '@/features/upload'
import {
  addAttachment, createLesson, createModule, deleteAttachment, deleteLesson, deleteModule,
  reorderLessons, reorderModules, setModuleRelease, updateLesson, updateModule, useCourseStructureQuery, structureKey,
} from '@/entities/authoring'
import { ModuleQuiz } from './ModuleQuiz'

/** Executa uma mutação: em caso de erro, mostra a mensagem; em caso de sucesso, recarrega. Nunca rejeita. */
type Run = (p: Promise<unknown>) => Promise<void>

function apiMessage(error: unknown, fallback: string): string {
  const msg = (error as { response?: { data?: { message?: string | string[] } } } | null)?.response?.data?.message
  if (Array.isArray(msg)) return msg.join(' ')
  return msg ?? fallback
}

/** Vídeo por link externo (YouTube/Vimeo/.mp4) vs objeto enviado ao GCS. */
function isExternalUrl(url: string | null): boolean {
  return !!url && /^https?:\/\//i.test(url)
}

/** ISO → valor de <input type="datetime-local"> no fuso local. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => {
      resolve(Math.round(v.duration) || 0)
      URL.revokeObjectURL(v.src)
    }
    v.onerror = () => resolve(0)
    v.src = URL.createObjectURL(file)
  })
}

function LessonRow({ courseId, lesson, run }: { courseId: string; lesson: AuthoringLesson; run: Run }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: lesson.id })
  const style = { transform: CSS.Transform.toString(transform), transition }

  async function onVideoDone(objectPath: string, file: File) {
    const durationSec = await readVideoDuration(file)
    await run(updateLesson(lesson.id, { videoUrl: objectPath, durationSec }))
  }

  return (
    <li ref={setNodeRef} style={style} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-bg p-2">
      <button type="button" {...attributes} {...listeners} className="cursor-grab text-muted" aria-label="Arrastar aula">
        <GripVertical className="size-4" />
      </button>
      <input
        defaultValue={lesson.title}
        onBlur={(e) => e.target.value !== lesson.title && run(updateLesson(lesson.id, { title: e.target.value }))}
        className="flex-1 rounded border border-border bg-card px-2 py-1 text-sm text-foreground"
      />
      {lesson.videoUrl ? (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-accent" title={isExternalUrl(lesson.videoUrl) ? 'Vídeo por link' : 'Vídeo enviado'}>
          <Check className="size-4" aria-hidden="true" />{isExternalUrl(lesson.videoUrl) ? 'link' : 'enviado'}
        </span>
      ) : null}
      <FileUploadButton kind="video" courseId={courseId} accept="video/*" label={lesson.videoUrl && !isExternalUrl(lesson.videoUrl) ? 'Trocar vídeo' : 'Enviar vídeo'} onDone={onVideoDone} />
      <FileUploadButton
        kind="attachment"
        courseId={courseId}
        label="Anexo"
        onDone={(objectPath, file) => run(addAttachment(lesson.id, file.name, objectPath))}
      />
      <label className="flex items-center gap-1 text-xs text-muted">
        <input type="checkbox" defaultChecked={lesson.isFreePreview} onChange={(e) => run(updateLesson(lesson.id, { isFreePreview: e.target.checked }))} />
        prévia grátis
      </label>
      <button type="button" onClick={() => run(deleteLesson(lesson.id))} className="text-muted hover:text-red-500" aria-label="Excluir aula">
        <Trash2 className="size-4" />
      </button>
      <div className="flex basis-full items-center gap-2 pl-6">
        <Youtube className="size-4 shrink-0 text-muted" aria-hidden="true" />
        <input
          defaultValue={isExternalUrl(lesson.videoUrl) ? lesson.videoUrl ?? '' : ''}
          onBlur={(e) => {
            const v = e.target.value.trim()
            const cur = isExternalUrl(lesson.videoUrl) ? (lesson.videoUrl ?? '') : ''
            if (v !== cur) run(updateLesson(lesson.id, { videoUrl: v || null }))
          }}
          placeholder="ou cole um link de vídeo (YouTube, Vimeo, .mp4…)"
          className="flex-1 rounded border border-border bg-card px-2 py-1 text-xs text-foreground"
        />
      </div>
      {lesson.attachments.length > 0 && (
        <ul className="min-w-0 basis-full pl-6 text-xs text-muted">
          {lesson.attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-1">
              <FileText className="size-3 shrink-0" />
              <span className="min-w-0 flex-1 truncate" title={a.fileName}>{a.fileName}</span>
              {a.url && (
                <a href={a.url} target="_blank" rel="noopener noreferrer" download className="inline-flex shrink-0 items-center gap-1 text-accent hover:text-brand-bright">
                  <Download className="size-3" /> baixar
                </a>
              )}
              <button type="button" onClick={() => run(deleteAttachment(a.id))} className="shrink-0 hover:text-red-500">remover</button>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function ModuleCard({ courseId, module, run }: { courseId: string; module: AuthoringModule; run: Run }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: module.id })
  const style = { transform: CSS.Transform.toString(transform), transition }
  const [newLesson, setNewLesson] = useState('')
  const [busy, setBusy] = useState(false)
  const sensors = useSensors(useSensor(PointerSensor))

  function onLessonDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (over && active.id !== over.id) {
      const ids = module.lessons.map((l) => l.id)
      const next = arrayMove(ids, ids.indexOf(active.id as string), ids.indexOf(over.id as string))
      run(reorderLessons(module.id, next))
    }
  }

  async function onAddLesson(e: FormEvent) {
    e.preventDefault()
    const title = newLesson.trim()
    if (!title) return
    setBusy(true)
    await run(createLesson(module.id, title).then(() => setNewLesson('')))
    setBusy(false)
  }

  return (
    <div ref={setNodeRef} style={style} className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <button type="button" {...attributes} {...listeners} className="cursor-grab text-muted" aria-label="Arrastar módulo">
          <GripVertical className="size-5" />
        </button>
        <input
          defaultValue={module.title}
          onBlur={(e) => e.target.value !== module.title && run(updateModule(module.id, e.target.value))}
          className="flex-1 rounded border border-border bg-bg px-2 py-1 font-bold text-foreground"
        />
        <button type="button" onClick={() => run(deleteModule(module.id))} className="text-muted hover:text-red-500" aria-label="Excluir módulo">
          <Trash2 className="size-5" />
        </button>
      </div>

      <label className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
        <CalendarClock className="size-4 text-brand" aria-hidden="true" />
        <span className="font-medium">Liberar em (gotejamento):</span>
        <input
          type="datetime-local"
          defaultValue={toLocalInput(module.availableAt)}
          onChange={(e) => run(setModuleRelease(module.id, e.target.value ? new Date(e.target.value).toISOString() : null))}
          className="rounded border border-border bg-bg px-2 py-1 text-foreground"
        />
        <span>vazio = abre junto com o curso</span>
      </label>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onLessonDragEnd}>
        <SortableContext items={module.lessons.map((l) => l.id)} strategy={verticalListSortingStrategy}>
          <ul className="mt-3 flex flex-col gap-2">
            {module.lessons.map((l) => <LessonRow key={l.id} courseId={courseId} lesson={l} run={run} />)}
          </ul>
        </SortableContext>
      </DndContext>
      {module.lessons.length === 0 && <p className="mt-3 text-sm text-muted">Sem aulas neste módulo. Adicione a primeira abaixo.</p>}

      <form onSubmit={onAddLesson} className="mt-3 flex gap-2">
        <input value={newLesson} onChange={(e) => setNewLesson(e.target.value)} placeholder="Nova aula" className="flex-1 rounded-lg border border-border bg-bg px-3 py-1.5 text-sm text-foreground" />
        <button type="submit" disabled={busy} className="rounded-full border border-brand px-3 py-1.5 text-sm font-bold text-brand hover:bg-brand-soft disabled:opacity-60">
          {busy ? 'Adicionando…' : '+ Aula'}
        </button>
      </form>

      <ModuleQuiz moduleId={module.id} />
    </div>
  )
}

export function Curriculum({ courseId }: { courseId: string }) {
  const structureQuery = useCourseStructureQuery(courseId)
  const qc = useQueryClient()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [newModule, setNewModule] = useState('')
  const sensors = useSensors(useSensor(PointerSensor))
  const modules = structureQuery.data ?? []

  const refresh = () => qc.invalidateQueries({ queryKey: structureKey(courseId) })
  const run: Run = async (p) => {
    setError('')
    try {
      await p
      await refresh()
    } catch (e) {
      setError(apiMessage(e, 'Não foi possível salvar. Verifique sua conexão com o servidor e tente novamente.'))
    }
  }

  function onModuleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (over && active.id !== over.id) {
      const ids = modules.map((m) => m.id)
      const next = arrayMove(ids, ids.indexOf(active.id as string), ids.indexOf(over.id as string))
      run(reorderModules(courseId, next))
    }
  }

  async function onAddModule(e: FormEvent) {
    e.preventDefault()
    const title = newModule.trim()
    if (!title) return
    setBusy(true)
    await run(createModule(courseId, title).then(() => setNewModule('')))
    setBusy(false)
  }

  return (
    <section className="mt-8">
      <h2 className="text-xl font-bold text-ink">Conteúdo e provas</h2>
      <p className="mt-1 text-sm text-muted">Organize em módulos e aulas (vídeo ou PDF). Cada módulo pode ter uma <strong>prova</strong> — use o botão <strong>“Prova do módulo”</strong> dentro do card. Arraste pelo ⠿ para reordenar.</p>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
      {structureQuery.isLoading && <p className="mt-4 text-muted">Carregando conteúdo…</p>}
      {structureQuery.isError && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>Não foi possível carregar o conteúdo. Verifique se o servidor está no ar e recarregue a página.</span>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onModuleDragEnd}>
        <SortableContext items={modules.map((m) => m.id)} strategy={verticalListSortingStrategy}>
          <div className="mt-4 flex flex-col gap-4">
            {modules.map((m) => <ModuleCard key={m.id} courseId={courseId} module={m} run={run} />)}
          </div>
        </SortableContext>
      </DndContext>

      {!structureQuery.isLoading && !structureQuery.isError && modules.length === 0 && (
        <p className="mt-4 rounded-lg border border-dashed border-border bg-bg p-4 text-sm text-muted">
          Nenhum módulo ainda. Comece criando o primeiro módulo abaixo. 👇
        </p>
      )}

      <form onSubmit={onAddModule} className="mt-4 flex gap-2">
        <input value={newModule} onChange={(e) => setNewModule(e.target.value)} placeholder="Nome do novo módulo (ex.: Introdução)" className="flex-1 rounded-lg border border-border bg-card px-4 py-2 text-foreground" />
        <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2 font-bold text-white hover:bg-brand-dark disabled:opacity-60">
          <Plus className="size-5" /> {busy ? 'Adicionando…' : 'Módulo'}
        </button>
      </form>
    </section>
  )
}
