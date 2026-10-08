import { useDeferredValue, useState } from 'react'
import { Award, Check, Copy, Eye, FileText, Plus, Save, Star, Trash2 } from 'lucide-react'
import type { CertificateTemplateSummary } from '@pilari/types'
import {
  useAssignTemplateMutation,
  useCertificateTemplateQuery,
  useCertificateTemplatesQuery,
  useCreateTemplateMutation,
  useDeleteTemplateMutation,
  usePreviewCertificateTemplateMutation,
  useSetDefaultTemplateMutation,
  usePlatformCoursesQuery,
  useStarterHtmlQuery,
  useUpdateTemplateMutation,
} from '@/entities/certificate-template'

/** Mensagem do servidor (em português, com o motivo da recusa); `fallback` só quando a resposta não trouxe uma. */
function apiMessage(error: unknown, fallback: string): string {
  const msg = (error as { response?: { data?: { message?: string | string[] } } } | null)?.response?.data?.message
  if (Array.isArray(msg)) return msg.join(' ')
  return msg ?? fallback
}

/** Variáveis disponíveis no template (espelham o buildData do backend). */
const VARIABLES: { key: string; label: string }[] = [
  { key: 'studentName', label: 'Nome do aluno' },
  { key: 'cpf', label: 'CPF' },
  { key: 'courseTitle', label: 'Nome do curso' },
  { key: 'hours', label: 'Carga horária' },
  { key: 'code', label: 'Código de validação' },
  { key: 'issuedAtBr', label: 'Data de emissão' },
  { key: 'verifyUrl', label: 'URL de validação' },
  { key: 'qrDataUri', label: 'QR (imagem)' },
  { key: 'bgDataUri', label: 'Arte de fundo (imagem)' },
  { key: 'coordinatorName', label: '2ª assinatura: nome' },
  { key: 'coordinatorRole', label: '2ª assinatura: cargo' },
]

const btnPrimary =
  'inline-flex cursor-pointer items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60'
const btnGhost =
  'inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-accent transition-colors hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-60'

/** `null` = nenhum selecionado; `'novo'` = criando. */
type Selecao = string | null | 'novo'

export function AdminCertificate() {
  const templatesQuery = useCertificateTemplatesQuery()
  const [selecao, setSelecao] = useState<Selecao>(null)

  const templates = templatesQuery.data
  // DERIVADO, não sincronizado por efeito: `selecao` nula significa "ainda não escolhi",
  // e aí vale o padrão. Guardar a escolha inicial em estado exigiria um efeito para
  // reagir à chegada da lista — e deixaria a tela vazia no primeiro render.
  const selecionado: Selecao =
    selecao ?? (templates?.length ? ((templates.find((t) => t.isDefault) ?? templates[0]).id ?? null) : null)

  return (
    <div>
      <div className="flex items-center gap-2">
        <Award className="size-6 text-brand" aria-hidden="true" />
        <h2 className="text-2xl font-bold text-ink">Certificados</h2>
      </div>
      <p className="mt-1 max-w-3xl text-sm text-muted">
        Um template é um layout de certificado. Cada curso pode usar o seu — útil quando um tem coordenador que assina
        e outro não. Curso sem template próprio usa o marcado como <strong>padrão</strong>.
      </p>

      {templatesQuery.isLoading && <p className="mt-6 text-muted">Carregando templates…</p>}
      {templatesQuery.isError && <p className="mt-6 text-red-500">Não foi possível carregar os templates.</p>}

      {templates && (
        <div className="mt-6 grid gap-5 lg:grid-cols-[260px_1fr]">
          <ListaTemplates templates={templates} selecao={selecionado} onSelecionar={setSelecao} />
          {selecionado === 'novo' ? (
            <EditorNovo onCriado={(id) => setSelecao(id)} onCancelar={() => setSelecao(null)} />
          ) : selecionado ? (
            /* key: trocar de template REMONTA o editor, zerando os campos rascunhados.
               É o que substitui o efeito de "recarregar ao trocar de id" — sem ele, o HTML
               do template anterior continuaria na tela e seria salvo por cima do errado. */
            <EditorExistente key={selecionado} id={selecionado} onApagado={() => setSelecao(null)} />
          ) : (
            <VazioSemTemplate onCriar={() => setSelecao('novo')} />
          )}
        </div>
      )}
    </div>
  )
}

function ListaTemplates({
  templates,
  selecao,
  onSelecionar,
}: {
  templates: CertificateTemplateSummary[]
  selecao: Selecao
  onSelecionar: (s: Selecao) => void
}) {
  return (
    <aside>
      <button type="button" onClick={() => onSelecionar('novo')} className={`${btnPrimary} w-full justify-center`}>
        <Plus className="size-4" aria-hidden="true" /> Novo template
      </button>
      <ul className="mt-3 flex flex-col gap-1.5">
        {templates.map((t) => {
          const ativo = t.id === selecao
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onSelecionar(t.id)}
                className={`w-full cursor-pointer rounded-lg border px-3 py-2 text-left transition-colors ${
                  ativo ? 'border-brand bg-brand-soft' : 'border-border hover:bg-brand-soft/50'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <FileText className="size-4 shrink-0 text-brand" aria-hidden="true" />
                  <span className="truncate text-sm font-bold text-ink">{t.name}</span>
                  {t.isDefault && <Star className="size-3.5 shrink-0 fill-brand text-brand" aria-label="padrão" />}
                </span>
                <span className="mt-0.5 block text-xs text-muted">
                  {t.isDefault
                    ? `padrão · ${t.courseCount} curso${t.courseCount === 1 ? '' : 's'} fixado${t.courseCount === 1 ? '' : 's'}`
                    : `${t.courseCount} curso${t.courseCount === 1 ? '' : 's'}`}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {templates.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          O padrão vale para todo curso que não fixou um template — por isso a contagem dele conta só os fixados.
        </p>
      )}
    </aside>
  )
}

function VazioSemTemplate({ onCriar }: { onCriar: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border p-10 text-center">
      <p className="text-sm text-muted">
        Nenhum template salvo. Os certificados estão saindo com o layout de fábrica embutido no sistema.
      </p>
      <button type="button" onClick={onCriar} className={btnPrimary}>
        <Plus className="size-4" aria-hidden="true" /> Criar o primeiro
      </button>
    </div>
  )
}

function EditorNovo({ onCriado, onCancelar }: { onCriado: (id: string) => void; onCancelar: () => void }) {
  const starter = useStarterHtmlQuery(true)
  const criar = useCreateTemplateMutation()
  const [name, setName] = useState('')
  // null = ainda não editou → mostra o HTML do padrão. Parte de algo pronto em vez de uma
  // caixa vazia: ninguém escreve um certificado do zero, e a arte de fundo depende de
  // variáveis fáceis de esquecer.
  const [rascunho, setRascunho] = useState<string | null>(null)
  const html = rascunho ?? starter.data ?? ''
  const setHtml = setRascunho

  return (
    <section>
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome do template (ex.: Com 2ª assinatura)"
          className="min-w-64 flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm font-bold text-ink"
        />
        <button
          type="button"
          onClick={() => criar.mutate({ name: name.trim(), html }, { onSuccess: onCriado })}
          disabled={criar.isPending || !name.trim() || !html.trim()}
          className={btnPrimary}
        >
          <Save className="size-4" aria-hidden="true" /> {criar.isPending ? 'Criando…' : 'Criar'}
        </button>
        <button type="button" onClick={onCancelar} className={btnGhost}>
          Cancelar
        </button>
      </div>
      {criar.isError && (
        <p className="mt-2 text-sm text-red-500">
          {apiMessage(criar.error, 'Falha ao criar.')}
        </p>
      )}
      <EditorHtml html={html} setHtml={setHtml} />
    </section>
  )
}

function EditorExistente({ id, onApagado }: { id: string; onApagado: () => void }) {
  const detalhe = useCertificateTemplateQuery(id)
  const salvar = useUpdateTemplateMutation()
  const marcarPadrao = useSetDefaultTemplateMutation()
  const apagar = useDeleteTemplateMutation()

  // null = ainda não editou → mostra o que veio do servidor. Deriva em vez de copiar para
  // o estado: copiar exigiria um efeito esperando a query, e no meio-tempo a tela mostraria
  // campos vazios. O remount por `key` no pai é o que zera isto ao trocar de template.
  const [nomeEditado, setNomeEditado] = useState<string | null>(null)
  const [htmlEditado, setHtmlEditado] = useState<string | null>(null)
  const [confirmandoApagar, setConfirmandoApagar] = useState(false)

  if (detalhe.isLoading) return <p className="text-muted">Carregando template…</p>
  if (detalhe.isError || !detalhe.data) return <p className="text-red-500">Não foi possível carregar este template.</p>

  const t = detalhe.data
  const name = nomeEditado ?? t.name
  const html = htmlEditado ?? t.html
  const setName = setNomeEditado
  const setHtml = setHtmlEditado
  const alterado = name !== t.name || html !== t.html

  return (
    <section>
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-w-64 flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm font-bold text-ink"
        />
        <button
          type="button"
          onClick={() => salvar.mutate({ id, name: name.trim(), html })}
          disabled={salvar.isPending || !alterado || !name.trim() || !html.trim()}
          className={btnPrimary}
        >
          <Save className="size-4" aria-hidden="true" /> {salvar.isPending ? 'Salvando…' : 'Salvar'}
        </button>
        {!t.isDefault && (
          <button
            type="button"
            onClick={() => marcarPadrao.mutate(id)}
            disabled={marcarPadrao.isPending}
            className={btnGhost}
          >
            <Star className="size-4" aria-hidden="true" /> Tornar padrão
          </button>
        )}
        {!t.isDefault &&
          (confirmandoApagar ? (
            <span className="inline-flex items-center gap-2 rounded-lg border border-red-300 px-3 py-1.5">
              <span className="text-sm text-red-500">Apagar? Os cursos voltam ao padrão.</span>
              <button
                type="button"
                onClick={() => apagar.mutate(id, { onSuccess: onApagado })}
                className="cursor-pointer text-sm font-bold text-red-600 hover:underline"
              >
                Sim
              </button>
              <button
                type="button"
                onClick={() => setConfirmandoApagar(false)}
                className="cursor-pointer text-sm text-muted hover:underline"
              >
                Não
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmandoApagar(true)} className={btnGhost}>
              <Trash2 className="size-4" aria-hidden="true" /> Apagar
            </button>
          ))}
        {t.isDefault && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-xs font-bold text-brand">
            <Star className="size-3.5 fill-brand" aria-hidden="true" /> Padrão
          </span>
        )}
        {salvar.isSuccess && !alterado && <span className="text-sm text-green-600">Salvo!</span>}
      </div>
      {salvar.isError && (
        <p className="mt-2 text-sm text-red-500">
          {apiMessage(salvar.error, 'Falha ao salvar.')}
        </p>
      )}
      {apagar.isError && (
        <p className="mt-2 text-sm text-red-500">
          {apiMessage(apagar.error, 'Falha ao apagar.')}
        </p>
      )}

      <CursosDoTemplate templateId={id} isDefault={t.isDefault} />
      <EditorHtml html={html} setHtml={setHtml} />
    </section>
  )
}

/**
 * Quais cursos usam este template. É aqui que "definir template por curso" acontece. O modelo vale para a rede inteira,
 * então a lista traz os cursos de TODOS os polos (com o polo de cada um), buscados no servidor pelo título.
 */
function CursosDoTemplate({ templateId, isDefault }: { templateId: string; isDefault: boolean }) {
  const vincular = useAssignTemplateMutation()
  const [busca, setBusca] = useState('')
  // A busca vai ao servidor; o valor adiado deixa a digitação fluir enquanto a lista da busca anterior continua na tela.
  const termo = useDeferredValue(busca.trim())
  const cursosQuery = usePlatformCoursesQuery(termo)
  // Já vem na ordem do servidor: a matriz primeiro, depois os polos por nome, e o título dentro de cada polo.
  const filtrados = cursosQuery.data ?? []

  const alternar = (courseId: string, usaEste: boolean) => {
    vincular.mutate({ templateId: usaEste ? null : templateId, courseIds: [courseId] })
  }

  return (
    <div className="mt-5 rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-ink">Cursos que usam este template (todos os polos)</h3>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar curso pelo título…"
          className="w-56 rounded-lg border border-border bg-bg px-3 py-1.5 text-sm font-normal text-foreground"
        />
      </div>
      {isDefault && (
        <p className="mt-1 text-xs text-muted">
          Este é o padrão: todo curso <strong>não marcado aqui nem em outro template</strong> já usa ele. Marcar fixa o
          vínculo explicitamente.
        </p>
      )}

      {cursosQuery.isLoading && <p className="mt-3 text-sm text-muted">Carregando cursos…</p>}
      {cursosQuery.isError && <p className="mt-3 text-sm text-red-500">Não foi possível carregar os cursos.</p>}

      <ul className="mt-3 flex max-h-64 flex-col gap-0.5 overflow-y-auto">
        {filtrados.map((c) => {
          const usaEste = c.certificateTemplateId === templateId
          const usaOutro = c.certificateTemplateId !== null && !usaEste
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => alternar(c.id, usaEste)}
                disabled={vincular.isPending}
                className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-brand-soft/50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span
                  className={`flex size-4 shrink-0 items-center justify-center rounded border ${
                    usaEste ? 'border-brand bg-brand' : 'border-border'
                  }`}
                >
                  {usaEste && <Check className="size-3 text-white" aria-hidden="true" />}
                </span>
                <span className="truncate text-sm text-foreground">{c.title}</span>
                <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] text-brand">{c.tenantName}</span>
                {usaOutro && (
                  <span className="ml-auto shrink-0 text-[11px] text-muted">usa outro template</span>
                )}
                {!usaEste && !usaOutro && <span className="ml-auto shrink-0 text-[11px] text-muted">usa o padrão</span>}
              </button>
            </li>
          )
        })}
        {filtrados.length === 0 && !cursosQuery.isLoading && (
          <li className="px-2 py-1.5 text-sm text-muted">Nenhum curso encontrado.</li>
        )}
      </ul>
      {vincular.isError && (
        <p className="mt-2 text-sm text-red-500">
          {apiMessage(vincular.error, 'Falha ao vincular.')}
        </p>
      )}
    </div>
  )
}

function EditorHtml({ html, setHtml }: { html: string; setHtml: (v: string) => void }) {
  // O mesmo modelo serve a rede: o preview pode usar o coordenador de um curso de qualquer polo.
  const cursosQuery = usePlatformCoursesQuery('')
  const preview = usePreviewCertificateTemplateMutation()
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewCourseId, setPreviewCourseId] = useState('')

  const gerarPreview = () => {
    preview.mutate(
      { html, courseId: previewCourseId || undefined },
      {
        // Revoga o anterior a cada preview novo: é aí que os object URLs se acumulariam
        // (um por clique). O último fica até a página sair, e isso é um blob só.
        onSuccess: (url) =>
          setPreviewUrl((old) => {
            if (old) URL.revokeObjectURL(old)
            return url
          }),
      }
    )
  }

  return (
    <>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="button" onClick={gerarPreview} disabled={preview.isPending || !html.trim()} className={btnGhost}>
          <Eye className="size-4" aria-hidden="true" /> {preview.isPending ? 'Gerando…' : 'Atualizar preview'}
        </button>
        <label className="text-xs font-medium text-muted">
          com os dados de{' '}
          <select
            value={previewCourseId}
            onChange={(e) => setPreviewCourseId(e.target.value)}
            className="rounded-lg border border-border bg-bg px-2 py-1 text-xs font-normal text-foreground"
          >
            <option value="">— curso de exemplo —</option>
            {(cursosQuery.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.tenantName} · {c.title}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-muted">
          Escolha um curso para ver a 2ª assinatura real; sem curso, o bloco não aparece.
        </span>
      </div>

      <div className="mt-4">
        <p className="text-xs font-medium text-muted">Variáveis (clique para copiar):</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {VARIABLES.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => void navigator.clipboard.writeText(`{{ ${v.key} }}`)}
              title={`Copiar {{ ${v.key} }}`}
              className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-brand-soft px-2 py-1 text-xs text-brand transition-colors hover:bg-brand hover:text-white"
            >
              <code>{v.key}</code>
              <Copy className="size-3 opacity-60" aria-hidden="true" />
              <span className="text-[10px] opacity-70">{v.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="flex flex-col">
          <label htmlFor="tpl-html" className="mb-1 text-xs font-medium text-muted">
            Código HTML
          </label>
          <textarea
            id="tpl-html"
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            spellCheck={false}
            className="h-[60vh] w-full resize-none rounded-lg border border-border bg-neutral-900 p-3 font-mono text-xs leading-relaxed text-neutral-100 focus:ring-2 focus:ring-brand focus:outline-none"
          />
        </div>

        <div className="flex flex-col">
          <span className="mb-1 text-xs font-medium text-muted">Preview (PDF real)</span>
          <div className="h-[60vh] overflow-hidden rounded-lg border border-border bg-neutral-100">
            {preview.isError ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-red-500">
                <span className="font-medium">Não foi possível gerar o preview.</span>
                {preview.error instanceof Error && (
                  <span className="max-w-md break-words text-xs text-red-400">{preview.error.message}</span>
                )}
              </div>
            ) : previewUrl ? (
              <iframe src={previewUrl} title="Preview do certificado" className="h-full w-full border-0" />
            ) : (
              <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted">
                Clique em “Atualizar preview” para ver o certificado gerado.
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
