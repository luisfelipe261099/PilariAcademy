import { useState } from 'react'
import { Image as ImageIcon } from 'lucide-react'
import { courseCoverSrc } from '@/entities/course'
import { FileUploadButton } from '@/features/upload'

function parseFocus(f: string | null): { x: number; y: number } {
  const m = f?.match(/(\d+)%\s+(\d+)%/)
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 50, y: 100 }
}

/** Capa do curso: upload de arquivo OU URL, com preview 16:9 e ajuste de enquadramento. */
export function CoverField({ courseId, coverImageUrl, coverFocus, onChange }: {
  courseId: string
  coverImageUrl: string | null
  coverFocus: string | null
  onChange: (patch: { coverImageUrl?: string | null; coverFocus?: string | null }) => void
}) {
  const [localPreview, setLocalPreview] = useState<string | null>(null)
  const { x, y } = parseFocus(coverFocus)

  const isHttp = !!coverImageUrl && /^https?:\/\//i.test(coverImageUrl)
  const previewSrc = localPreview ?? courseCoverSrc(courseId, coverImageUrl)

  return (
    <div>
      <span className="text-sm font-bold text-ink">Capa do curso</span>

      <div className="mt-1 grid aspect-video w-full place-items-center overflow-hidden rounded-xl border border-border bg-brand-soft">
        {previewSrc ? (
          <img src={previewSrc} alt="Capa do curso" className="size-full object-cover" style={{ objectPosition: `${x}% ${y}%` }} />
        ) : (
          <div className="text-center text-muted">
            <ImageIcon className="mx-auto size-10" aria-hidden="true" />
            <p className="mt-1 text-sm">Sem capa — envie uma imagem</p>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <FileUploadButton
          kind="cover"
          courseId={courseId}
          accept="image/*"
          label="Enviar imagem"
          onDone={(objectPath, file) => { setLocalPreview(URL.createObjectURL(file)); onChange({ coverImageUrl: objectPath }) }}
        />
        <span className="text-xs text-muted">ou cole uma URL:</span>
        <input
          value={isHttp ? coverImageUrl! : ''}
          onChange={(e) => { setLocalPreview(null); onChange({ coverImageUrl: e.target.value || null }) }}
          placeholder="https://…"
          className="min-w-[12rem] flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm font-normal text-foreground"
        />
      </div>

      {previewSrc && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-muted">Enquadramento horizontal
            <input type="range" min={0} max={100} value={x} onChange={(e) => onChange({ coverFocus: `${Number(e.target.value)}% ${y}%` })} className="mt-1 w-full accent-brand" />
          </label>
          <label className="text-xs font-medium text-muted">Enquadramento vertical
            <input type="range" min={0} max={100} value={y} onChange={(e) => onChange({ coverFocus: `${x}% ${Number(e.target.value)}%` })} className="mt-1 w-full accent-brand" />
          </label>
        </div>
      )}
    </div>
  )
}
