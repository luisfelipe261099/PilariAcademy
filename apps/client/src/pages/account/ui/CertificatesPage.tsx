import { Link } from 'react-router-dom'
import { Award, Download, ShieldCheck } from 'lucide-react'
import { useDownloadCertificateMutation } from '@/entities/certificate'
import { canDownloadCertificate, formatDateTime, useMyCertificatesQuery } from '@/entities/my-account'

export function CertificatesPage() {
  const { data, isLoading, isError } = useMyCertificatesQuery()
  const baixar = useDownloadCertificateMutation()

  return (
    <div>
      <h2 className="text-2xl font-bold text-ink">Certificados</h2>
      <p className="mt-1 text-sm text-muted">
        Certificados já emitidos. Cada um tem um código de validação público.
      </p>

      {isLoading && <p className="mt-4 text-muted">Carregando…</p>}
      {isError && <p className="mt-4 text-red-500">Não foi possível carregar seus certificados.</p>}
      {data && data.length === 0 && (
        <div className="mt-5 flex flex-col items-center gap-2 rounded-2xl border border-border bg-card p-10 text-center">
          <Award className="size-8 text-muted" aria-hidden="true" />
          <p className="font-medium text-ink">Nenhum certificado ainda</p>
          <p className="text-sm text-muted">
            Conclua 100% de um curso e seja aprovado nas provas para emitir o primeiro.
          </p>
        </div>
      )}

      <div className="mt-5 flex flex-col gap-4">
        {data?.map((c) => (
          <article key={c.code} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-card p-5">
            <div className="min-w-0">
              <h3 className="font-bold text-ink">{c.courseTitle}</h3>
              <p className="mt-0.5 text-xs text-muted">
                {c.hours ? `${c.hours}h · ` : ''}emitido em {formatDateTime(c.issuedAt)}
              </p>
              <Link
                to={`/certificado/${c.code}`}
                className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
              >
                <ShieldCheck className="size-3.5" aria-hidden="true" /> Página de validação
              </Link>
            </div>
            {canDownloadCertificate(c) ? (
              <button
                type="button"
                onClick={() => baixar.mutate({ slug: c.courseSlug })}
                disabled={baixar.isPending}
                className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
              >
                <Download className="size-4" aria-hidden="true" /> {baixar.isPending ? 'Gerando…' : 'Baixar PDF'}
              </button>
            ) : (
              <span className="shrink-0 rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-800">Revogado</span>
            )}
          </article>
        ))}
      </div>
      {baixar.isError && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-600">
          {baixar.error instanceof Error ? baixar.error.message : 'Não foi possível baixar o certificado.'}
        </p>
      )}
    </div>
  )
}
