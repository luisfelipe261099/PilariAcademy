import { useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Award, ArrowLeft, CalendarClock, Download, ExternalLink, FileText, Lock, SkipForward } from 'lucide-react'
import { useMediaQuery } from '@/shared/lib/use-media-query'
import { useClassroomQuery, useSetProgressMutation } from '@/entities/classroom'
import { useDownloadCarneMutation, useDownloadCertificateMutation, useSettlementQuery } from '@/entities/certificate'
import { isValidFullName } from '@/entities/certificate/lib/certificate-form'
import { carneBlockedInfo } from '@/entities/certificate/lib/settlement'
import { CourseSidebar } from './CourseSidebar'
import { ReviewsTab } from './ReviewsTab'
import { NotesTab } from './NotesTab'
import { AnnouncementsTab } from './AnnouncementsTab'
import { StudentModuleQuiz } from './StudentModuleQuiz'
import { StudentMessages } from './StudentMessages'
import { GradesTab } from './GradesTab'
import { classroomErrorView } from '../lib/classroom-error-view'
import { TutorButton } from './TutorButton'

const TABS = [
  { key: 'overview', label: 'Visão geral' },
  { key: 'materials', label: 'Materiais' },
  { key: 'notes', label: 'Observações' },
  { key: 'grades', label: 'Boletim' },
  { key: 'reviews', label: 'Avaliações' },
  { key: 'announcements', label: 'Anúncios' },
  { key: 'messages', label: 'Mensagens' },
] as const
type TabKey = (typeof TABS)[number]['key']

/** Se a URL for de YouTube, devolve a URL de embed (iframe); senão null (usa <video>). */
function youTubeEmbed(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|v\/)|youtu\.be\/)([\w-]{11})/i)
  return m ? `https://www.youtube.com/embed/${m[1]}` : null
}

export function ClassroomPage() {
  const { slug } = useParams()
  const { data, isLoading, isError, error, refetch } = useClassroomQuery(slug ?? '')
  const setProgress = useSetProgressMutation(slug ?? '')
  const certMutation = useDownloadCertificateMutation()
  const settlementQuery = useSettlementQuery(slug ?? '')
  const carneMutation = useDownloadCarneMutation()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [quizModuleId, setQuizModuleId] = useState<string | null>(null)
  const [tab, setTab] = useState<TabKey>('overview')
  const [askData, setAskData] = useState(false)
  const [cpfInput, setCpfInput] = useState('')
  const [nameInput, setNameInput] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const isDesktop = useMediaQuery('(min-width: 1024px)')

  const viewingQuiz = quizModuleId !== null
  const quizModule = useMemo(() => data?.modules.find((m) => m.id === quizModuleId) ?? null, [data, quizModuleId])

  const allLessons = useMemo(() => data?.modules.flatMap((m) => m.lessons) ?? [], [data])
  const current =
    allLessons.find((l) => l.id === selectedId) ?? allLessons.find((l) => !l.completed) ?? allLessons[0] ?? null
  const currentModule = useMemo(
    () => data?.modules.find((m) => m.lessons.some((l) => l.id === current?.id)) ?? null,
    [data, current]
  )
  // Próximo na sequência: próxima aula do módulo → prova do módulo → 1ª aula do próximo módulo.
  const nextNav = useMemo(() => {
    if (!current || !currentModule || !data) return null
    const ls = currentModule.lessons
    const idx = ls.findIndex((l) => l.id === current.id)
    if (idx >= 0 && idx < ls.length - 1) return { kind: 'lesson' as const, id: ls[idx + 1].id, label: 'Próxima aula' }
    if (currentModule.hasQuiz) return { kind: 'quiz' as const, moduleId: currentModule.id, label: 'Fazer a prova' }
    const mi = data.modules.findIndex((m) => m.id === currentModule.id)
    const firstOfNext = data.modules[mi + 1]?.lessons[0]
    return firstOfNext ? { kind: 'lesson' as const, id: firstOfNext.id, label: 'Próximo módulo' } : null
  }, [current, currentModule, data])

  function goToLesson(id: string) {
    setSelectedId(id)
    setQuizModuleId(null)
    setTab('overview')
  }
  const ytEmbed = current?.signedVideoUrl ? youTubeEmbed(current.signedVideoUrl) : null
  // Aula sem vídeo: os PDFs anexos viram o conteúdo do "palco" (estudo inline).
  // Vários PDFs → seletor de abas; o ativo é renderizado no iframe.
  const pdfDocs = useMemo(
    () => current?.attachments.filter((a) => /\.pdf$/i.test(a.fileName)) ?? [],
    [current]
  )
  const [selectedPdfId, setSelectedPdfId] = useState<string | null>(null)
  // Deriva o PDF ativo do estado, caindo no 1º quando troca de aula (sem useEffect).
  const activePdf = pdfDocs.find((p) => p.id === selectedPdfId) ?? pdfDocs[0] ?? null

  if (isLoading) return <div className="mx-auto max-w-3xl px-4 py-24 text-center text-muted">Carregando sala de aula…</div>

  if (isError || !data) {
    const view = classroomErrorView(error, slug ?? '')
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center sm:px-6">
        <h1 className="text-2xl font-bold text-ink">{view.title}</h1>
        <p className="mt-2 text-muted">{view.message}</p>
        <Link to={view.link.to} className="mt-6 inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-dark">
          <ArrowLeft className="size-4" aria-hidden="true" /> {view.link.label}
        </Link>
      </div>
    )
  }

  if (data.locked) {
    const when = data.availableAt ? new Date(data.availableAt).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' }) : ''
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="text-2xl font-bold text-ink">{data.title}</h1>
        <div className="mt-6 rounded-2xl border border-border bg-card p-8 text-center">
          <Lock className="mx-auto size-12 text-brand" aria-hidden="true" />
          <h2 className="mt-3 text-xl font-bold text-ink">Curso em pré-venda</h2>
          <p className="mt-2 text-muted">Seu acesso está garantido! O conteúdo será liberado em:</p>
          <p className="mt-1 inline-flex items-center gap-2 text-lg font-bold text-brand">
            <CalendarClock className="size-5" aria-hidden="true" /> {when}
          </p>
        </div>
        <h3 className="mt-8 font-bold text-ink">O que você vai estudar</h3>
        <ul className="mt-3 flex flex-col gap-2">
          {data.modules.map((m) => (
            <li key={m.id} className="rounded-xl border border-border bg-card p-4">
              <p className="font-bold text-ink">{m.title}</p>
              <ul className="mt-1 flex flex-col gap-0.5 text-sm text-muted">
                {m.lessons.map((l) => <li key={l.id}>• {l.title}</li>)}
                {m.hasQuiz && <li>• Prova do módulo</li>}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  // Certificado: só habilita com 100% das aulas + aprovação (nota ≥ 7) em toda prova do
  // curso. Espelha a checagem do backend (certificate.service) para não oferecer um
  // download que voltaria 403. `quizPassed` já vem por módulo no payload do classroom.
  const pendingQuizzes = data.modules.filter((m) => m.hasQuiz && !m.quizPassed).length
  const lessonsDone = data.progressPercent === 100
  // O carnê em aberto é um gate como qualquer outro: sem ele aqui, o botão fica
  // habilitado e convida a um clique que o servidor SEMPRE recusa com 403.
  const blocked = carneBlockedInfo(settlementQuery.data)
  const certificateReady = lessonsDone && pendingQuizzes === 0 && !blocked
  // O certificado exige nome E CPF. Faltando qualquer um, o botão abre o formulário
  // em vez de disparar um download que voltaria 400.
  const faltamDados = !data.hasCpf || !data.hasName
  const dadosValidos =
    (data.hasCpf || cpfInput.replace(/\D/g, '').length === 11) &&
    (data.hasName || isValidFullName(nameInput))
  const certificateHint = blocked
    ? blocked.message
    : !lessonsDone
    ? 'Conclua todas as aulas e seja aprovado nas provas (nota ≥ 7) para emitir o certificado.'
    : `Você precisa ser aprovado em ${pendingQuizzes === 1 ? '1 prova' : `${pendingQuizzes} provas`} (nota ≥ 7) para emitir o certificado.`
  // Gate independente do progresso do curso: mesmo com 100% das aulas e provas, o
  // certificado fica preso até o carnê (boleto parcelado) quitar.

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      {data.tutor && slug && <TutorButton slug={slug} moduleId={currentModule?.id ?? null} />}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-bold text-ink">{data.title}</h1>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted">{data.progressPercent}% concluído</span>
          {askData && faltamDados ? (
            <div className="flex flex-wrap items-center gap-2">
              {!data.hasName && (
                <input
                  type="text"
                  placeholder="Nome completo"
                  aria-label="Nome completo"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  maxLength={120}
                  className="w-56 rounded-full border border-border px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand"
                />
              )}
              {!data.hasCpf && (
                <input
                  type="text"
                  placeholder="CPF (000.000.000-00)"
                  aria-label="CPF"
                  value={cpfInput}
                  onChange={(e) => setCpfInput(e.target.value)}
                  maxLength={14}
                  className="w-44 rounded-full border border-border px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand"
                />
              )}
              <button
                type="button"
                onClick={() =>
                  slug &&
                  certMutation.mutate(
                    { slug, cpf: data.hasCpf ? undefined : cpfInput, nome: data.hasName ? undefined : nameInput },
                    { onSuccess: () => { setAskData(false); setCpfInput(''); setNameInput('') } }
                  )
                }
                disabled={!dadosValidos || certMutation.isPending}
                className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-brand"
              >
                <Award className="size-4" aria-hidden="true" /> {certMutation.isPending ? 'Gerando…' : 'Emitir certificado'}
              </button>
              <button
                type="button"
                onClick={() => { setAskData(false); setCpfInput(''); setNameInput('') }}
                className="cursor-pointer rounded-full border border-border px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-brand-soft hover:text-ink"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (!slug || !certificateReady) return
                if (faltamDados) setAskData(true)
                else certMutation.mutate({ slug })
              }}
              disabled={!certificateReady || certMutation.isPending}
              title={certificateReady ? undefined : certificateHint}
              className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-brand"
            >
              <Award className="size-4" aria-hidden="true" /> {certMutation.isPending ? 'Gerando…' : 'Baixar certificado'}
            </button>
          )}
        </div>
      </div>
      {certMutation.isError && (
        <p role="alert" className="mt-2 text-sm font-medium text-red-600">
          {certMutation.error instanceof Error ? certMutation.error.message : 'Não foi possível emitir o certificado.'}
        </p>
      )}

      {blocked && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-900">{blocked.message}</p>
          <button
            type="button"
            onClick={() => carneMutation.mutate(blocked.carneUrl)}
            disabled={carneMutation.isPending}
            className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-full border border-amber-400 bg-white px-3 py-1.5 text-sm font-bold text-amber-900 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <FileText className="size-4" aria-hidden="true" /> {carneMutation.isPending ? 'Baixando…' : 'Baixar carnê'}
          </button>
        </div>
      )}
      {carneMutation.isError && (
        <p role="alert" className="mt-2 text-sm font-medium text-red-600">
          {carneMutation.error instanceof Error ? carneMutation.error.message : 'Não foi possível baixar o carnê.'}
        </p>
      )}

      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* COLUNA PRINCIPAL — min-w-0: sem isso, a fila de abas (nowrap, ~600px) propaga
            largura mínima pro item do grid e estoura a página no mobile. */}
        <div className="min-w-0">
          {viewingQuiz && quizModule ? (
            <StudentModuleQuiz key={quizModule.id} moduleId={quizModule.id} moduleTitle={quizModule.title} onResult={() => void refetch()} />
          ) : (
          <>
          {currentModule?.locked ? (
            <div className="grid aspect-video w-full place-items-center rounded-2xl border border-border bg-card p-6 text-center">
              <div>
                <Lock className="mx-auto size-12 text-brand" aria-hidden="true" />
                <h2 className="mt-3 text-xl font-bold text-ink">Módulo bloqueado</h2>
                <p className="mt-1 text-muted">Este módulo será liberado em:</p>
                <p className="mt-0.5 inline-flex items-center gap-2 text-lg font-bold text-brand">
                  <CalendarClock className="size-5" aria-hidden="true" />
                  {currentModule.availableAt ? new Date(currentModule.availableAt).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' }) : ''}
                </p>
              </div>
            </div>
          ) : current?.signedVideoUrl ? (
            <div className="overflow-hidden rounded-2xl border border-border bg-black">
              {ytEmbed ? (
                <iframe
                  key={current.id}
                  src={ytEmbed}
                  title={current.title}
                  className="aspect-video w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  // O site manda Referrer-Policy: no-referrer (helmet) e o YouTube recusa embed sem a origem (Erro 153).
                  // Aqui vai só a origem do site para o YouTube, nunca o caminho da aula.
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                />
              ) : (
                <video
                  ref={videoRef}
                  key={current.id}
                  src={current.signedVideoUrl}
                  controls
                  className="aspect-video w-full"
                  onEnded={() => current && setProgress.mutate({ lessonId: current.id, completed: true })}
                />
              )}
            </div>
          ) : activePdf ? (
            // Sem vídeo: PDF(s) ocupam o palco — estuda na plataforma ou baixa.
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-2.5">
                {pdfDocs.length > 1 ? (
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-xs font-bold uppercase tracking-wide text-muted">{pdfDocs.length} PDFs:</span>
                    {pdfDocs.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedPdfId(p.id)}
                        title={p.fileName}
                        aria-pressed={p.id === activePdf.id}
                        className={
                          'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-colors ' +
                          (p.id === activePdf.id ? 'bg-brand text-white' : 'border border-border text-ink hover:bg-brand-soft')
                        }
                      >
                        <FileText className="size-3.5 shrink-0" aria-hidden="true" />
                        <span className="max-w-[12rem] truncate">{p.fileName}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="inline-flex min-w-0 flex-1 items-center gap-2 text-sm font-bold text-ink">
                    <FileText className="size-4 shrink-0 text-brand" aria-hidden="true" />
                    <span className="truncate">{activePdf.fileName}</span>
                  </span>
                )}
                <a
                  href={activePdf.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-sm font-bold text-white transition-colors hover:bg-brand-dark"
                >
                  <Download className="size-4" aria-hidden="true" /> Baixar
                </a>
              </div>
              {isDesktop ? (
                <iframe
                  key={activePdf.id}
                  src={activePdf.url}
                  title={activePdf.fileName}
                  // Sem sandbox de propósito: o Chrome recusa abrir o leitor de PDF dentro de um iframe com
                  // sandbox ("Esta página foi bloqueada pelo Chrome"), mesmo na mesma origem. O risco que o
                  // sandbox cobria — anexo da mesma origem rodando JS — não existe aqui: o proxy só entrega
                  // arquivo que começa com a assinatura de PDF, com Content-Type application/pdf e nosniff,
                  // e o CSP (frame-src) só aceita iframe do próprio site e do YouTube.
                  className="h-[78vh] w-full bg-white"
                />
              ) : (
                // No celular, o iframe embutido fica apertado (e ainda dispara o bloqueio de
                // DevTools do domínio Google). Abrir em tela cheia usa o leitor de PDF nativo.
                <a
                  href={activePdf.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col items-center gap-3 px-6 py-12 text-center"
                >
                  <FileText className="size-14 text-brand" aria-hidden="true" />
                  <span className="font-bold text-ink">Abrir o PDF para leitura</span>
                  <span className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white">
                    <ExternalLink className="size-4" aria-hidden="true" /> Abrir em tela cheia
                  </span>
                  <span className="max-w-xs text-xs text-muted">
                    No celular, abrir em tela cheia usa o leitor do navegador — com zoom e navegação melhores que a prévia embutida.
                  </span>
                </a>
              )}
            </div>
          ) : null}

          {current && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-ink">{current.title}</h2>
              <div className="flex items-center gap-2">
                {!current.completed && (
                  <button type="button" onClick={() => setProgress.mutate({ lessonId: current.id, completed: true })} className="rounded-full border border-border px-3 py-1.5 text-sm font-medium text-ink hover:bg-brand-soft">
                    Marcar concluída
                  </button>
                )}
                {nextNav && (
                  <button
                    type="button"
                    onClick={() => (nextNav.kind === 'lesson' ? goToLesson(nextNav.id) : setQuizModuleId(nextNav.moduleId))}
                    className="inline-flex items-center gap-1 rounded-full bg-brand px-4 py-1.5 text-sm font-bold text-white hover:bg-brand-dark"
                  >
                    {nextNav.label} <SkipForward className="size-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ABAS */}
          <div className="mt-4 flex flex-wrap gap-1 border-b border-border">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={'whitespace-nowrap border-b-2 px-3 py-2 text-sm font-bold transition-colors ' + (tab === t.key ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink')}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="mt-4">
            {tab === 'overview' && (
              <div>
                {current?.description ? <p className="whitespace-pre-wrap text-muted">{current.description}</p> : <p className="text-muted">Esta aula não tem descrição.</p>}
              </div>
            )}

            {tab === 'materials' && (
              <div>
                {current && current.attachments.length > 0 ? (
                  <ul className="flex flex-col gap-2">
                    {current.attachments.map((a) => (
                      <li key={a.id}>
                        <a href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-accent hover:text-brand-bright">
                          <Download className="size-4" aria-hidden="true" /> {a.fileName}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted">Esta aula não tem materiais.</p>
                )}
              </div>
            )}

            {tab === 'notes' && slug && (
              <NotesTab
                slug={slug}
                lessonId={current?.id ?? null}
                getTime={() => videoRef.current?.currentTime ?? 0}
                onSeek={(sec) => { const v = videoRef.current; if (v) { v.currentTime = sec; void v.play().catch(() => undefined) } }}
              />
            )}

            {tab === 'grades' && slug && <GradesTab slug={slug} />}

            {tab === 'reviews' && slug && <ReviewsTab slug={slug} />}

            {tab === 'announcements' && slug && <AnnouncementsTab slug={slug} />}

            {tab === 'messages' && slug && <StudentMessages slug={slug} />}
          </div>
          </>
          )}
        </div>

        {/* SIDEBAR */}
        <CourseSidebar
          modules={data.modules}
          currentId={viewingQuiz ? null : current?.id ?? null}
          currentModuleId={viewingQuiz ? quizModuleId : currentModule?.id ?? null}
          activeQuizModuleId={quizModuleId}
          onSelect={goToLesson}
          onSelectQuiz={(moduleId) => setQuizModuleId(moduleId)}
          onToggleComplete={(lesson) => setProgress.mutate({ lessonId: lesson.id, completed: !lesson.completed })}
        />
      </div>
    </div>
  )
}
