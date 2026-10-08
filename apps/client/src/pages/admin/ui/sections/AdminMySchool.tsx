import { requestBrandingUpload, useMyTenantQuery, useUpdateMyTenantMutation } from '@/entities/tenant'
import { BrandingForm } from '@/widgets/branding-form'

function apiMessage(error: unknown, fallback: string): string {
  const msg = (error as { response?: { data?: { message?: string | string[] } } } | null)?.response?.data?.message
  if (Array.isArray(msg)) return msg.join(' ')
  return msg ?? fallback
}

/** O admin do polo cuida da marca do próprio site. Nome e endereço são definidos pelo Studio Pilari. */
export function AdminMySchool() {
  const query = useMyTenantQuery()
  const salvar = useUpdateMyTenantMutation()

  if (query.isLoading) return <p className="text-muted">Carregando…</p>
  if (query.isError || !query.data) return <p className="text-red-500">Não foi possível carregar os dados da escola.</p>
  const s = query.data

  if (s.isMatriz) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-ink">Minha escola</h2>
        <p className="mt-2 text-muted">A marca do site do Studio Pilari é cuidada pelo console da plataforma, em Polos.</p>
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-ink">Minha escola</h2>
      <p className="mt-1 text-sm text-muted">
        Logo, cores e contatos do site{' '}
        <a href={s.siteUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-accent hover:underline">
          {s.siteUrl.replace(/^https:\/\//, '')}
        </a>
        . O nome do polo e o endereço do site são definidos pelo Studio Pilari.
      </p>
      {salvar.isSuccess && (
        <p role="status" className="mt-3 rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand">Alterações salvas. O site mostra a marca nova em até um minuto.</p>
      )}
      <BrandingForm
        initial={s.branding}
        preview={s.publicBranding}
        showColors
        requestUpload={(kind, file) => requestBrandingUpload({ kind, fileName: file.name, contentType: file.type })}
        onSubmit={(input) => salvar.mutate(input)}
        pending={salvar.isPending}
        error={salvar.isError ? apiMessage(salvar.error, 'Não foi possível salvar.') : null}
      />
    </div>
  )
}
