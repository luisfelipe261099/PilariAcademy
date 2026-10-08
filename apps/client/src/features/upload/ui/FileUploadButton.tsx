import { useState, type ChangeEvent } from 'react'
import { Upload } from 'lucide-react'
import { requestUploadUrl } from '@/entities/authoring'
import { uploadToSignedUrl } from '../lib/upload'
import { limparAssinatura } from '../lib/limpar-assinatura'

interface FileUploadButtonProps {
  kind: 'video' | 'cover' | 'attachment' | 'signature'
  courseId: string
  accept?: string
  label: string
  onDone: (objectPath: string, file: File) => void
}

export function FileUploadButton({ kind, courseId, accept, label, onDone }: FileUploadButtonProps) {
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  async function handle(e: ChangeEvent<HTMLInputElement>) {
    const escolhido = e.target.files?.[0]
    if (!escolhido) return
    setError(null)
    setAviso(null)
    setProgress(0)
    try {
      // A rubrica vai impressa POR CIMA da linha do certificado: fundo branco desenha um
      // retângulo que corta o traço. Limpa aqui, antes de subir, para o que fica guardado
      // já ser o PNG transparente — e o preview mostrar exatamente isso.
      let file = escolhido
      if (kind === 'signature') {
        const limpa = await limparAssinatura(escolhido)
        file = limpa.arquivo
        setAviso(limpa.aviso)
      }
      const ticket = await requestUploadUrl({ kind, courseId, fileName: file.name, contentType: file.type || 'application/octet-stream' })
      await uploadToSignedUrl(ticket.uploadUrl, file, setProgress)
      onDone(ticket.objectPath, file)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no upload')
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
      {aviso && <span className="max-w-64 text-xs text-amber-600">{aviso}</span>}
    </div>
  )
}
