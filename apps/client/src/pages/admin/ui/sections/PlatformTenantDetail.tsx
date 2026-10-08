import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import type { TenantBrandingInput } from '@pilari/types'
import {
  apiErrorCode, requestPlatformTenantUpload, tenantAdminMessage, tenantNameError, tenantNamePatch, usePlatformTenantMutations, usePlatformTenantQuery,
} from '@/entities/platform'
import { TENANT_KEY } from '@/entities/tenant'
import { BrandingForm, previewFromSite } from '@/widgets/branding-form'

const campo = 'mt-1 w-full rounded-lg border border-border bg-bg px-4 py-2 font-normal text-foreground'

function apiMessage(error: unknown, fallback: string): string {
  const msg = (error as { response?: { data?: { message?: string | string[] } } } | null)?.response?.data?.message
  if (Array.isArray(msg)) return msg.join(' ')
  return msg ?? fallback
}

function VoltarParaPolos() {
  return (
    <Link to="/admin/polos" className="inline-flex items-center gap-2 text-sm font-medium text-accent hover:text-brand-bright">
      <ArrowLeft className="size-4" aria-hidden="true" /> Polos
    </Link>
  )
}

export function PlatformTenantDetail() {
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const query = usePlatformTenantQuery(id)
  const m = usePlatformTenantMutations(id)
  const [nome, setNome] = useState<string | null>(null)
  const [confirmandoStatus, setConfirmandoStatus] = useState(false)
  const [adminEmail, setAdminEmail] = useState('')
  const [adminName, setAdminName] = useState('')
  const [dominio, setDominio] = useState('')
  // Domínio esperando a segunda confirmação da remoção: remover por engano faz o endereço, se já estiver no ar, parar de abrir o polo.
  const [removendo, setRemovendo] = useState<string | null>(null)

  if (query.isLoading) return <p className="text-muted">Carregando…</p>
  if (query.isError || !query.data) {
    // 404 TENANT_NOT_FOUND é polo que não existe; qualquer outra falha (rede, permissão) não é "não encontrado".
    const naoExiste = apiErrorCode(query.error) === 'TENANT_NOT_FOUND'
    return (
      <div>
        <VoltarParaPolos />
        <p role="alert" className="mt-3 text-red-500">{naoExiste ? 'Polo não encontrado.' : apiMessage(query.error, 'Não foi possível carregar o polo.')}</p>
      </div>
    )
  }
  const t = query.data
  const principal = new URL(t.siteUrl).host
  const suspenso = t.status === 'suspended'
  const patchNome = tenantNamePatch(t.name, nome)
  const erroNome = nome !== null ? tenantNameError(nome) : null

  function salvarNome(e: FormEvent) {
    e.preventDefault()
    // Sem patchNome não há o que enviar: o servidor responde 400 "Nada para alterar." a PATCH vazio.
    if (patchNome) m.update.mutate(patchNome, { onSuccess: () => setNome(null) })
  }
  function vincularAdmin(e: FormEvent) {
    e.preventDefault()
    m.addAdmin.mutate({ email: adminEmail.trim(), name: adminName.trim() }, { onSuccess: () => { setAdminEmail(''); setAdminName('') } })
  }
  function cadastrarDominio(e: FormEvent) {
    e.preventDefault()
    m.removeDomain.reset()
    m.addDomain.mutate(dominio.trim(), { onSuccess: () => setDominio('') })
  }
  function removerDominio(host: string) {
    m.addDomain.reset()
    m.removeDomain.mutate(host, { onSuccess: () => setRemovendo(null) })
  }
  function salvarMarca(branding: TenantBrandingInput) {
    m.saveBranding.mutate(branding, {
      // Na matriz, o site em que o console está aberto é o próprio polo editado: cabeçalho, rodapé e contatos leem a
      // consulta do polo do endereço, que só volta a buscar se for invalidada.
      onSuccess: () => { if (t.isMatriz) void qc.invalidateQueries({ queryKey: TENANT_KEY }) },
    })
  }

  return (
    <div>
      <VoltarParaPolos />
      <h2 className="mt-3 text-2xl font-bold text-ink">{t.name}</h2>
      <p className="mt-1 text-sm text-muted">
        <a href={t.siteUrl} target="_blank" rel="noopener noreferrer" className="hover:text-accent">{principal}</a> · {t.adminCount} admin(s) · {t.studentCount} aluno(s) · {t.publishedCourseCount} curso(s) publicado(s)
      </p>

      <section className="mt-6 grid gap-3 rounded-2xl border border-border bg-card p-5">
        <h3 className="text-lg font-bold text-ink">Dados do polo</h3>
        <form onSubmit={salvarNome} className="flex flex-wrap items-end gap-3">
          <label className="min-w-64 flex-1 text-sm font-bold text-ink">Nome
            <input value={nome ?? t.name} onChange={(e) => setNome(e.target.value)} maxLength={160} className={campo} />
          </label>
          <button type="submit" disabled={!patchNome || m.update.isPending} className="rounded-full bg-brand px-5 py-2 font-bold text-white disabled:opacity-60">Salvar nome</button>
        </form>
        {erroNome && <p className="text-sm text-red-500">{erroNome}</p>}
        {!t.isMatriz && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-ink">Situação: <strong>{suspenso ? 'Suspenso (loja fechada; alunos e painel continuam)' : 'Ativo'}</strong></span>
            {confirmandoStatus ? (
              <>
                <button type="button" disabled={m.update.isPending} onClick={() => m.update.mutate({ status: suspenso ? 'active' : 'suspended' }, { onSuccess: () => setConfirmandoStatus(false) })} className="rounded-full bg-red-500 px-4 py-1.5 text-sm font-bold text-white disabled:opacity-60">
                  Confirmar {suspenso ? 'reativação' : 'suspensão'}
                </button>
                <button type="button" onClick={() => setConfirmandoStatus(false)} className="text-sm text-muted">cancelar</button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmandoStatus(true)} className="rounded-full border border-border px-4 py-1.5 text-sm font-bold text-ink hover:bg-brand-soft">
                {suspenso ? 'Reativar' : 'Suspender'}
              </button>
            )}
          </div>
        )}
        {m.update.isError && <p role="alert" className="text-sm text-red-500">{apiMessage(m.update.error, 'Não foi possível salvar.')}</p>}
      </section>

      <h3 className="mt-8 text-lg font-bold text-ink">Marca</h3>
      <BrandingForm
        key={`${t.id}-${t.siteUrl}`}
        initial={t.branding}
        preview={previewFromSite(t.branding, t.siteUrl)}
        showColors={!t.isMatriz}
        requestUpload={(kind, file) => requestPlatformTenantUpload(t.id, { kind, fileName: file.name, contentType: file.type })}
        onSubmit={salvarMarca}
        pending={m.saveBranding.isPending}
        error={m.saveBranding.isError ? apiMessage(m.saveBranding.error, 'Não foi possível salvar a marca.') : null}
      />
      {m.saveBranding.isSuccess && <p role="status" className="mt-3 rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand">Marca salva.</p>}

      <section className="mt-8 grid gap-3 rounded-2xl border border-border bg-card p-5">
        <h3 className="text-lg font-bold text-ink">Admins do polo</h3>
        <p className="text-sm text-muted">
          E-mail novo vira conta e recebe o link para definir a senha. Quem já tem conta na rede entra com a senha de sempre; se nunca entrou, o link é enviado de novo.
        </p>
        <form onSubmit={vincularAdmin} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="text-sm font-bold text-ink">E-mail
            <input required type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} className={campo} />
          </label>
          <label className="text-sm font-bold text-ink">Nome
            <input required value={adminName} onChange={(e) => setAdminName(e.target.value)} maxLength={120} className={campo} />
          </label>
          <button type="submit" disabled={m.addAdmin.isPending} className="rounded-full bg-brand px-5 py-2 font-bold text-white disabled:opacity-60">Vincular admin</button>
        </form>
        {m.addAdmin.data && <p role="status" className="text-sm text-brand">{tenantAdminMessage(m.addAdmin.data)}</p>}
        {m.addAdmin.isError && <p role="alert" className="text-sm text-red-500">{apiMessage(m.addAdmin.error, 'Não foi possível vincular.')}</p>}
      </section>

      <section className="mt-8 grid gap-3 rounded-2xl border border-border bg-card p-5">
        <h3 className="text-lg font-bold text-ink">Domínios</h3>
        <ul className="grid gap-1 text-sm">
          {t.domains.map((d) => (
            <li key={d} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
              <span className="font-mono">{d}</span>
              {d === principal ? (
                <span className="text-xs text-muted">principal</span>
              ) : removendo === d ? (
                <span className="flex items-center gap-3">
                  <button type="button" onClick={() => removerDominio(d)} disabled={m.removeDomain.isPending} aria-label={`Confirmar a remoção do domínio ${d}`} className="rounded-full bg-red-500 px-3 py-1 text-xs font-bold text-white disabled:opacity-60">
                    {m.removeDomain.isPending ? 'Removendo…' : 'Confirmar remoção'}
                  </button>
                  <button type="button" onClick={() => setRemovendo(null)} className="text-xs text-muted">cancelar</button>
                </span>
              ) : (
                <button type="button" onClick={() => setRemovendo(d)} aria-label={`Remover o domínio ${d}`} className="text-xs text-red-500 hover:underline">remover</button>
              )}
              {removendo === d && d !== principal && <p className="basis-full text-xs text-muted">Quem abrir o site por este endereço deixa de encontrar o polo.</p>}
            </li>
          ))}
        </ul>
        <form onSubmit={cadastrarDominio} className="flex flex-wrap items-end gap-3">
          <label className="min-w-64 flex-1 text-sm font-bold text-ink">Domínio próprio
            <input required value={dominio} onChange={(e) => setDominio(e.target.value)} placeholder="cursos.escoladopolo.com.br" className={campo} />
          </label>
          <button type="submit" disabled={m.addDomain.isPending} className="rounded-full border border-brand px-5 py-2 font-bold text-brand hover:bg-brand-soft disabled:opacity-60">Cadastrar</button>
        </form>
        <p className="text-xs text-muted">O cadastro reserva o domínio para o polo. A ligação de DNS e do certificado é feita pela equipe técnica.</p>
        {m.addDomain.isError && <p role="alert" className="text-sm text-red-500">{apiMessage(m.addDomain.error, 'Não foi possível cadastrar o domínio.')}</p>}
        {m.removeDomain.isError && <p role="alert" className="text-sm text-red-500">{apiMessage(m.removeDomain.error, 'Não foi possível remover o domínio.')}</p>}
      </section>
    </div>
  )
}
