import { useState, type ChangeEvent } from 'react'
import { Upload } from 'lucide-react'
import type { UploadTicket } from '@pilari/types'
import { uploadToSignedUrl } from '../lib/upload'

interface SignedUploadButtonProps {
  accept: string
  label: string
  requestTicket: (file: File) => Promise<UploadTicket>
  onDone: (objectPath: string, file: File) => void
}

function mensagem(err: unknown): string {
  const api = (err as { response?: { data?: { message?: string | string[] } } } | null)?.response?.data?.message
  if (Array.isArray(api)) return api.join(' ')
  if (api) return api
  return err instanceof Error ? err.message : 'Falha no upload'
}

/** Envio direto ao GCS por URL assinada, para qualquer destino que devolva um UploadTicket. */
export function SignedUploadButton({ accept, label, requestTicket, onDone }: SignedUploadButtonProps) {
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handle(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setProgress(0)
    try {
      const ticket = await requestTicket(file)
      await uploadToSignedUrl(ticket.uploadUrl, file, setProgress)
      onDone(ticket.objectPath, file)
    } catch (err) {
      setError(mensagem(err))
    } finally {
      setProgress(null)
      e.target.value = ''
    }
  }

  return (
    <div className="inline-flex flex-col gap-1">
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-brand px-4 py-2 text-sm font-bold text-brand transition-colors hover:bg-brand-soft">
        <Upload className="size-4" aria-hidden="true" />
        {progress != null ? `Enviando… ${progress}%` : label}
        <input type="file" accept={accept} onChange={handle} className="hidden" disabled={progress != null} />
      </label>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  )
}
