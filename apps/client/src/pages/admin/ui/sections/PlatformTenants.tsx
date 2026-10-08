import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  tenantAdminMessage, tenantNameError, tenantSlugError, useCreatePlatformTenantMutation, usePlatformTenantsQuery,
} from '@/entities/platform'

const campo = 'mt-1 w-full rounded-lg border border-border bg-bg px-4 py-2 font-normal text-foreground'

function apiMessage(error: unknown, fallback: string): string {
  const msg = (error as { response?: { data?: { message?: string | string[] } } } | null)?.response?.data?.message
  if (Array.isArray(msg)) return msg.join(' ')
  return msg ?? fallback
}

export function PlatformTenants() {
  const lista = usePlatformTenantsQuery()
  const criar = useCreatePlatformTenantMutation()
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [primaryColor, setPrimaryColor] = useState('#5c6e5a')
  const [whatsapp, setWhatsapp] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [adminName, setAdminName] = useState('')
  const erroSlug = slug ? tenantSlugError(slug) : null
  const erroNome = name ? tenantNameError(name) : null
  // O domínio base vem da configuração do servidor: a matriz mora nele (siteUrl dela é https://<base>).
  const matriz = lista.data?.find((t) => t.isMatriz)
  const dominioBase = matriz ? new URL(matriz.siteUrl).host : 'cursos.studiopilari.com.br'

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    criar.mutate(
      {
        slug: slug.trim(),
        name: name.trim(),
        branding: { primaryColor, whatsapp: whatsapp.replace(/\D/g, '') || null },
        firstAdminEmail: adminEmail.trim(),
        firstAdminName: adminName.trim(),
      },
      { onSuccess: () => { setSlug(''); setName(''); setWhatsapp(''); setAdminEmail(''); setAdminName('') } }
    )
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-ink">Polos</h2>
      <p className="mt-1 text-sm text-muted">Escolas parceiras da rede. Cada polo tem o próprio site, alunos e cursos.</p>

      {lista.isLoading && <p className="mt-4 text-muted">Carregando…</p>}
      {lista.isError && <p className="mt-4 text-red-500">{apiMessage(lista.error, 'Não foi possível carregar os polos.')}</p>}
      {lista.data && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm text-ink">
            <thead className="text-xs text-muted">
              <tr className="border-b border-border">
                <th className="py-2 pr-3 font-medium">Polo</th>
                <th className="px-3 font-medium">Site</th>
                <th className="px-3 font-medium">Situação</th>
                <th className="px-3 font-medium">Admins</th>
                <th className="px-3 font-medium">Alunos</th>
                <th className="px-3 font-medium">Publicados</th>
                <th className="px-3 font-medium">Em análise</th>
              </tr>
            </thead>
            <tbody>
              {lista.data.map((t) => (
                <tr key={t.id} className="border-b border-border">
                  <td className="py-2 pr-3">
                    <Link to={`/admin/polos/${t.id}`} className="font-medium text-accent hover:text-brand-bright">{t.name}</Link>
                    {t.isMatriz && <span className="ml-2 rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand">matriz</span>}
                  </td>
                  <td className="px-3"><a href={t.siteUrl} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-accent">{t.siteUrl.replace(/^https:\/\//, '')}</a></td>
                  <td className="px-3">{t.status === 'active' ? 'Ativo' : <span className="font-bold text-red-500">Suspenso</span>}</td>
                  <td className="px-3">{t.adminCount}</td>
                  <td className="px-3">{t.studentCount}</td>
                  <td className="px-3">{t.publishedCourseCount}</td>
                  <td className="px-3">{t.inReviewCount > 0 ? <Link to="/admin/aprovacao" className="font-bold text-accent">{t.inReviewCount}</Link> : 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={onSubmit} className="mt-8 grid gap-3 rounded-2xl border border-border bg-card p-5 sm:grid-cols-2">
        <h3 className="text-lg font-bold text-ink sm:col-span-2">Novo polo</h3>
        <label className="text-sm font-bold text-ink">Nome do polo
          <input required value={name} onChange={(e) => setName(e.target.value)} maxLength={160} className={campo} />
          {erroNome && <span className="mt-1 block text-xs font-normal text-red-500">{erroNome}</span>}
        </label>
        <label className="text-sm font-bold text-ink">Endereço do site
          <input required value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} maxLength={40} placeholder="polo-centro" className={campo} />
          <span className={'mt-1 block text-xs font-normal ' + (erroSlug ? 'text-red-500' : 'text-muted')}>
            {erroSlug ?? `${slug || 'endereco'}.${dominioBase}`}
          </span>
        </label>
        <label className="text-sm font-bold text-ink">Cor principal
          <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="mt-1 block h-10 w-14 cursor-pointer rounded border border-border bg-bg" />
        </label>
        <label className="text-sm font-bold text-ink">WhatsApp do polo (com DDI e DDD)
          <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} inputMode="numeric" placeholder="5541999999999" className={campo} />
        </label>
        <label className="text-sm font-bold text-ink">E-mail do primeiro admin
          <input required type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} className={campo} />
        </label>
        <label className="text-sm font-bold text-ink">Nome do primeiro admin
          <input required value={adminName} onChange={(e) => setAdminName(e.target.value)} maxLength={120} className={campo} />
        </label>
        {criar.isError && <p role="alert" className="text-sm text-red-500 sm:col-span-2">{apiMessage(criar.error, 'Não foi possível criar o polo.')}</p>}
        {criar.data && (
          <p role="status" className="rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand sm:col-span-2">
            Polo {criar.data.tenant.name} criado. {tenantAdminMessage(criar.data.firstAdmin)}{' '}
            <Link to={`/admin/polos/${criar.data.tenant.id}`} className="font-bold underline">Abrir o polo</Link>
          </p>
        )}
        <button type="submit" disabled={criar.isPending || Boolean(erroSlug) || Boolean(erroNome)} className="self-start rounded-full bg-brand px-5 py-2 font-bold text-white disabled:opacity-60 sm:col-span-2">
          {criar.isPending ? 'Criando…' : 'Criar polo'}
        </button>
      </form>
    </div>
  )
}
