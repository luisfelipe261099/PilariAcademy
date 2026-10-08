import { useParams } from 'react-router-dom'
import { CheckCircle2, XCircle, Download } from 'lucide-react'
import { useVerifyCertificateQuery } from '@/entities/certificate'
import { certificateDocumentUrl } from '@/entities/certificate/api'

export function CertificateVerifyPage() {
  const { code } = useParams()
  const { data, isLoading, isError } = useVerifyCertificateQuery(code ?? '')

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
      <h1 className="text-2xl font-bold text-ink">Verificação de certificado</h1>
      <p className="mt-1 text-muted">Código: <code className="rounded bg-brand-soft px-1.5 py-0.5 text-brand">{code}</code></p>

      {isLoading && <p className="mt-6 text-muted">Verificando…</p>}
      {isError && <p className="mt-6 text-red-500">Não foi possível verificar.</p>}

      {data && (
        data.valid ? (
          <div className="mt-6 rounded-2xl border border-border bg-card p-6">
            <CheckCircle2 className="mx-auto size-12 text-accent" aria-hidden="true" />
            <p className="mt-3 text-lg font-bold text-ink">Certificado válido</p>
            <p className="mt-2 text-muted">
              <strong>{data.studentName ?? 'Aluno'}</strong> concluiu o curso{' '}
              <strong>{data.courseTitle}</strong>
              {data.issuedAt ? ` em ${new Date(data.issuedAt).toLocaleDateString('pt-BR')}` : ''}.
            </p>
            {data.poloName && (
              <p className="mt-2 text-sm text-muted">
                Curso oferecido por <strong>{data.poloName}</strong>, com certificado emitido pelo Studio Pilari.
              </p>
            )}

            {data.hasDocument && code && (
              <div className="mt-6">
                <iframe
                  src={certificateDocumentUrl(code)}
                  title="Certificado"
                  className="h-[60vh] w-full rounded-xl border border-border bg-white"
                />
                <a
                  href={certificateDocumentUrl(code, true)}
                  className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-dark"
                >
                  <Download className="size-4" aria-hidden="true" /> Baixar PDF
                </a>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-border bg-card p-6">
            <XCircle className="mx-auto size-12 text-red-500" aria-hidden="true" />
            <p className="mt-3 text-lg font-bold text-ink">Certificado não encontrado</p>
            <p className="mt-2 text-muted">O código informado não corresponde a nenhum certificado.</p>
          </div>
        )
      )}
    </div>
  )
}
