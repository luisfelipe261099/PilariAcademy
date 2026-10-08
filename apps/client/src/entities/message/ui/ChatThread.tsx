import { useState, type FormEvent } from 'react'
import { Send } from 'lucide-react'
import type { Message } from '@pilari/types'

function fmtTime(iso: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** Thread de chat reutilizável. `viewerIsStudent` alinha as bolhas (minhas à direita). */
export function ChatThread({
  messages, viewerIsStudent, onSend, sending, emptyHint,
}: {
  messages: Message[]
  viewerIsStudent: boolean
  onSend: (body: string) => void
  sending: boolean
  emptyHint?: string
}) {
  const [text, setText] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    const body = text.trim()
    if (!body || sending) return
    onSend(body)
    setText('')
  }

  return (
    <div className="flex flex-col">
      <div className="flex max-h-[420px] flex-col gap-2 overflow-y-auto p-1">
        {messages.length === 0 && <p className="py-8 text-center text-sm text-muted">{emptyHint ?? 'Nenhuma mensagem ainda.'}</p>}
        {messages.map((m) => {
          const mine = viewerIsStudent === m.fromStudent
          return (
            <div key={m.id} className={'flex ' + (mine ? 'justify-end' : 'justify-start')}>
              <div className={'max-w-[80%] rounded-2xl px-3 py-2 text-sm ' + (mine ? 'bg-brand text-white' : 'border border-border bg-card text-ink')}>
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <p className={'mt-0.5 text-[10px] ' + (mine ? 'text-white/70' : 'text-muted')}>{fmtTime(m.createdAt)}</p>
              </div>
            </div>
          )
        })}
      </div>
      <form onSubmit={submit} className="mt-2 flex items-center gap-2 border-t border-border pt-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Escreva uma mensagem…"
          className="flex-1 rounded-full border border-border bg-bg px-4 py-2 text-sm text-foreground"
        />
        <button type="submit" disabled={sending || !text.trim()} className="inline-flex items-center gap-1 rounded-full bg-brand px-4 py-2 text-sm font-bold text-white hover:bg-brand-dark disabled:opacity-60">
          <Send className="size-4" aria-hidden="true" /> {sending ? '…' : 'Enviar'}
        </button>
      </form>
    </div>
  )
}
