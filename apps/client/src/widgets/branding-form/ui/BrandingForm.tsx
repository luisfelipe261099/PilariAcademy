import { useState, type FormEvent } from 'react'
import type { BrandingAssetKind, TenantBranding, TenantBrandingInput, UploadTicket } from '@pilari/types'
import { SignedUploadButton } from '@/features/upload'
import { brandingFormErrors, brandingToForm, formToBrandingInput, type BrandingFormState } from '../lib/branding-form'

type CampoImagem = 'logoUrl' | 'logoLightUrl' | 'faviconUrl'

const IMAGENS: Array<{ kind: BrandingAssetKind; field: CampoImagem; label: string; ajuda: string }> = [
  { kind: 'logo', field: 'logoUrl', label: 'Logo', ajuda: 'Cabeçalho, rodapé e login. PNG com fundo transparente fica melhor.' },
  { kind: 'logo-light', field: 'logoLightUrl', label: 'Logo para o tema escuro', ajuda: 'Opcional: versão clara da logo, para quem usa o tema escuro.' },
  { kind: 'favicon', field: 'faviconUrl', label: 'Ícone da aba (favicon)', ajuda: 'Imagem quadrada, de preferência 64 × 64 pixels.' },
]

const campo = 'mt-1 w-full rounded-lg border border-border bg-bg px-4 py-2 font-normal text-foreground'
const rotulo = 'text-sm font-bold text-ink'

export interface BrandingFormProps {
  /** Marca crua (caminhos do bucket). */
  initial: TenantBranding
  /** Marca com URLs públicas, para as prévias do que já está salvo. */
  preview: TenantBranding
  showColors: boolean
  requestUpload: (kind: BrandingAssetKind, file: File) => Promise<UploadTicket>
  onSubmit: (input: TenantBrandingInput) => void
  pending: boolean
  error: string | null
}

export function BrandingForm({ initial, preview, showColors, requestUpload, onSubmit, pending, error }: BrandingFormProps) {
  const [form, setForm] = useState<BrandingFormState>(() => brandingToForm(initial))
  const [previas, setPrevias] = useState<Partial<Record<BrandingAssetKind, string>>>({})
  const erros = brandingFormErrors(form)
  const set = <K extends keyof BrandingFormState>(k: K, v: BrandingFormState[K]) => setForm((f) => ({ ...f, [k]: v }))

  function trocarPrevia(kind: BrandingAssetKind, url: string | null) {
    setPrevias((p) => {
      const antiga = p[kind]
      if (antiga) URL.revokeObjectURL(antiga)
      return { ...p, [kind]: url ?? undefined }
    })
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (erros.length === 0) onSubmit(formToBrandingInput(form))
  }

  return (
    <form onSubmit={submit} className="mt-4 grid gap-4 rounded-2xl border border-border bg-card p-5">
      <h3 className="text-lg font-bold text-ink">Imagens</h3>
      {IMAGENS.map(({ kind, field, label, ajuda }) => {
        const salva = form[field] !== null && form[field] === initial[field] ? preview[field] : null
        const src = previas[kind] ?? salva
        return (
          <div key={kind} className="flex flex-wrap items-center gap-4">
            <div className="grid h-20 w-40 place-items-center overflow-hidden rounded-lg border border-border bg-white">
              {src ? <img src={src} alt={label} className="max-h-full max-w-full object-contain" /> : <span className="px-2 text-center text-xs text-muted">Sem imagem</span>}
            </div>
            <div className="min-w-0 flex-1">
              <p className={rotulo}>{label}</p>
              <p className="text-xs text-muted">{ajuda}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <SignedUploadButton
                  accept="image/png,image/jpeg,image/webp"
                  label={form[field] ? 'Trocar' : 'Enviar'}
                  requestTicket={(file) => requestUpload(kind, file)}
                  onDone={(objectPath, file) => {
                    set(field, objectPath)
                    trocarPrevia(kind, URL.createObjectURL(file))
                  }}
                />
                {form[field] && (
                  <button type="button" onClick={() => { set(field, null); trocarPrevia(kind, null) }} className="text-sm text-red-500 hover:underline">
                    Remover
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })}

      {showColors && (
        <>
          <h3 className="mt-2 text-lg font-bold text-ink">Cores</h3>
          {/* A cor dos botões de ação (accentColor) não aparece: nenhum componente usa os tokens laranja. O valor salvo volta no envio. */}
          <ColorField
            label="Cor principal"
            ajuda="Cabeçalho, botões e destaques. Cores muito claras são escurecidas no site para o texto branco dos botões continuar legível."
            value={form.primaryColor}
            onChange={(v) => set('primaryColor', v)}
          />
        </>
      )}

      <h3 className="mt-2 text-lg font-bold text-ink">Contatos</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={rotulo}>WhatsApp (com DDI e DDD)
          <input value={form.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} inputMode="numeric" placeholder="5541999999999" className={campo} />
        </label>
        <label className={rotulo}>Telefone
          <input value={form.phone} onChange={(e) => set('phone', e.target.value)} maxLength={40} className={campo} />
        </label>
        <label className={rotulo}>E-mail
          <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} maxLength={160} className={campo} />
        </label>
        <label className={rotulo}>Endereço
          <input value={form.address} onChange={(e) => set('address', e.target.value)} maxLength={300} className={campo} />
        </label>
      </div>

      <h3 className="mt-2 text-lg font-bold text-ink">Textos do site</h3>
      <label className={rotulo}>Descrição (rodapé e resultados de busca)
        <textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={3} maxLength={300} className={campo} />
      </label>
      <label className={rotulo}>Título da página inicial
        <input value={form.heroTitle} onChange={(e) => set('heroTitle', e.target.value)} maxLength={120} placeholder="Vazio = texto padrão" className={campo} />
      </label>
      <label className={rotulo}>Subtítulo da página inicial
        <textarea value={form.heroSubtitle} onChange={(e) => set('heroSubtitle', e.target.value)} rows={2} maxLength={300} placeholder="Vazio = texto padrão com o nome do polo" className={campo} />
      </label>

      {erros.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-red-500">
          {erros.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      <button type="submit" disabled={pending || erros.length > 0} className="self-start rounded-full bg-brand px-5 py-2 font-bold text-white disabled:opacity-60">
        {pending ? 'Salvando…' : 'Salvar'}
      </button>
    </form>
  )
}

function ColorField({ label, ajuda, value, onChange }: { label: string; ajuda: string; value: string; onChange: (v: string) => void }) {
  const valida = /^#[0-9a-fA-F]{6}$/.test(value)
  return (
    <div>
      <span className={rotulo}>{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <input type="color" value={valida ? value : '#000000'} onChange={(e) => onChange(e.target.value)} aria-label={label} className="h-10 w-14 cursor-pointer rounded border border-border bg-bg" />
        <input value={value} onChange={(e) => onChange(e.target.value)} aria-label={`${label} em hexadecimal`} className="w-32 rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-foreground" />
      </div>
      <p className="mt-1 max-w-xl text-xs text-muted">{ajuda}</p>
    </div>
  )
}
