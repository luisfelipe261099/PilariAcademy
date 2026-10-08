import { useState } from 'react'
import { useTakedownCourseMutation } from '../queries'

function apiMessage(error: unknown, fallback: string): string {
  const msg = (error as { response?: { data?: { message?: string | string[] } } } | null)?.response?.data?.message
  if (Array.isArray(msg)) return msg.join(' ')
  return msg ?? fallback
}

/** O Studio Pilari tira do ar um curso publicado, com motivo. O polo só recoloca no ar com nova análise. */
export function TakedownButton({ courseId, onDone }: { courseId: string; onDone: () => void }) {
  const [aberto, setAberto] = useState(false)
  const [nota, setNota] = useState('')
  const tirar = useTakedownCourseMutation()
  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)} className="rounded-full border border-red-200 px-3 py-1 text-xs font-bold text-red-600 hover:bg-red-50">
        Tirar do ar (Studio Pilari)
      </button>
    )
  }
  return (
    <span className="flex flex-col gap-1">
      <textarea
        value={nota}
        onChange={(e) => setNota(e.target.value)}
        rows={2}
        maxLength={1000}
        aria-label="Motivo para tirar o curso do ar"
        placeholder="Motivo (o polo vê esta nota)"
        className="w-56 rounded border border-border bg-bg px-2 py-1 text-xs text-foreground"
      />
      <span className="flex items-center gap-2">
        <button
          type="button"
          disabled={tirar.isPending || nota.trim().length < 3}
          onClick={() => tirar.mutate({ courseId, note: nota.trim() }, { onSuccess: () => { setAberto(false); setNota(''); onDone() } })}
          className="rounded-full bg-red-500 px-3 py-1 text-xs font-bold text-white disabled:opacity-60"
        >
          {tirar.isPending ? 'Tirando…' : 'Confirmar'}
        </button>
        <button type="button" onClick={() => { tirar.reset(); setAberto(false) }} className="text-xs text-muted hover:text-ink">cancelar</button>
      </span>
      {tirar.isError && <span role="alert" className="max-w-56 text-xs text-red-500">{apiMessage(tirar.error, 'Não foi possível tirar do ar.')}</span>}
    </span>
  )
}
