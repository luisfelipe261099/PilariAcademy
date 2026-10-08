import { Fragment, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { Role, type CourseStatus, type InstructorCourse } from '@pilari/types'
import { useCategoriesQuery } from '@/entities/category'
import { useMeQuery } from '@/entities/auth'
import { useTenant } from '@/entities/tenant'
import {
  courseStatusUi,
  metaFormKey,
  omitLockedFields,
  setCourseStatus,
  updateCourseMeta,
  useInstructorCourseQuery,
  type HintPart,
  type UpdateCourseInput,
} from '@/entities/authoring'
import { Curriculum } from './Curriculum'
import { AnnouncementsManager } from './AnnouncementsManager'
import { CoverField } from './CoverField'
import { FileUploadButton } from '@/features/upload'

const STATUS_LABEL: Record<CourseStatus, string> = { draft: 'Rascunho', in_review: 'Em revisão', published: 'Publicado', archived: 'Arquivado' }

/** ISO → valor de <input type="datetime-local"> ("YYYY-MM-DDTHH:mm") no fuso local. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function apiMessage(error: unknown, fallback: string): string {
  const msg = (error as { response?: { data?: { message?: string | string[] } } } | null)?.response?.data?.message
  if (Array.isArray(msg)) return msg.join(' ')
  return msg ?? fallback
}

function HintText({ parts }: { parts: HintPart[] }) {
  return <>{parts.map((p, i) => (typeof p === 'string' ? <Fragment key={i}>{p}</Fragment> : <strong key={i}>{p.strong}</strong>))}</>
}

function MetaForm({ course, refetch }: { course: InstructorCourse; refetch: () => void }) {
  const categoriesQuery = useCategoriesQuery()
  const [title, setTitle] = useState(course.title)
  const [subtitle, setSubtitle] = useState(course.subtitle ?? '')
  const [description, setDescription] = useState(course.description ?? '')
  const [categoryId, setCategoryId] = useState(course.categoryId ?? '')
  const [priceReais, setPriceReais] = useState((course.priceInCents / 100).toString())
  const [promoReais, setPromoReais] = useState(course.promoPriceInCents != null ? (course.promoPriceInCents / 100).toString() : '')
  const [promoEndsAt, setPromoEndsAt] = useState(toLocalInput(course.promoEndsAt))
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(course.coverImageUrl)
  const [coverFocus, setCoverFocus] = useState<string | null>(course.coverFocus)
  const [coordName, setCoordName] = useState(course.coordinatorName ?? '')
  const [coordRole, setCoordRole] = useState(course.coordinatorRole ?? 'Coordenador(a) do Curso')
  const [coordSig, setCoordSig] = useState<string | null>(course.coordinatorSignaturePath)
  const [carga, setCarga] = useState(course.workloadHours != null ? String(course.workloadHours) : '')
  // Object URL do arquivo recém-enviado: a rota de preview só enxerga o que já foi SALVO,
  // então sem isto o admin envia a rubrica e não vê nada até salvar e recarregar.
  const [coordSigPreview, setCoordSigPreview] = useState<string | null>(null)
  const [availableAt, setAvailableAt] = useState(toLocalInput(course.availableAt))
  const [tutorEnabled, setTutorEnabled] = useState(course.tutorEnabled)

  const saveMutation = useMutation({
    mutationFn: (patch: UpdateCourseInput) => updateCourseMeta(course.id, patch),
    onSuccess: () => refetch(),
  })
  const statusMutation = useMutation({
    mutationFn: (status: CourseStatus) => setCourseStatus(course.id, status),
    onSuccess: () => refetch(),
  })
  const { data: me } = useMeQuery()
  const tenant = useTenant()
  const isAdmin = me?.roles.includes(Role.admin) ?? false
  // Tutor de voz: o custo é do Studio Pilari, então só a equipe da plataforma liga (o servidor também barra).
  const isPlatformAdmin = me?.user?.isPlatformAdmin ?? false
  const locked = course.certificateFieldsLocked
  const published = course.status === 'published'
  const inReview = course.status === 'in_review'
  // Botão e texto de apoio seguem a regra do servidor: na matriz o admin publica direto; no polo, a primeira
  // publicação passa pela análise do Studio Pilari.
  const ui = courseStatusUi({
    status: course.status,
    approvedAt: course.approvedAt,
    reviewNote: course.reviewNote,
    isTenantAdmin: isAdmin,
    isPlatformAdmin,
    isMatriz: tenant.isMatriz,
  })

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">{course.title || 'Curso sem título'}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className={'rounded-full px-2 py-0.5 text-xs font-bold ' + (published ? 'bg-accent/15 text-accent' : inReview ? 'bg-brand/15 text-brand' : 'bg-muted/15 text-muted')}>
              {STATUS_LABEL[course.status] ?? course.status}
            </span>
            <span>{course.moduleCount} módulos · {course.lessonCount} aulas</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => statusMutation.mutate(ui.action.to)}
          disabled={statusMutation.isPending}
          className={'rounded-full px-5 py-2 font-bold text-white disabled:opacity-60 ' + (ui.action.primary ? 'bg-brand hover:bg-brand-dark' : 'bg-muted')}
        >
          {ui.action.label}
        </button>
      </div>
      {statusMutation.isError && <p className="mt-2 text-sm text-red-500">{apiMessage(statusMutation.error, 'Erro ao mudar status.')}</p>}
      {course.reviewNote && (
        <div role="alert" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-bold">O Studio Pilari pediu ajustes neste curso</p>
          <p className="mt-1 whitespace-pre-line">{course.reviewNote}</p>
        </div>
      )}
      {ui.hint && (
        <p className="mt-2 text-sm text-muted">
          <HintText parts={ui.hint} />
        </p>
      )}

      <h2 className="mt-6 text-lg font-bold text-ink">Dados do curso</h2>
      <section className="mt-2 grid gap-3 rounded-2xl border border-border bg-card p-5">
        {locked && (
          <p className="rounded-lg bg-brand-soft px-3 py-2 text-sm text-accent">
            Curso aprovado pelo Studio Pilari: título, carga horária e coordenador saem no certificado e só mudam pelo
            Studio Pilari. Para alterar, fale com o Studio Pilari.
          </p>
        )}
        <label className="text-sm font-bold text-ink">Título
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={locked} className="mt-1 w-full rounded-lg border border-border bg-bg px-4 py-2 font-normal text-foreground disabled:cursor-not-allowed disabled:opacity-60" />
        </label>
        <label className="text-sm font-bold text-ink">Subtítulo
          <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-bg px-4 py-2 font-normal text-foreground" />
        </label>
        <label className="text-sm font-bold text-ink">Descrição
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className="mt-1 w-full rounded-lg border border-border bg-bg px-4 py-2 font-normal text-foreground" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-bold text-ink">Categoria
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-bg px-4 py-2 font-normal text-foreground">
              <option value="">— sem categoria —</option>
              {categoriesQuery.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="text-sm font-bold text-ink">Preço (R$)
            <input value={priceReais} onChange={(e) => setPriceReais(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-lg border border-border bg-bg px-4 py-2 font-normal text-foreground" />
          </label>
        </div>
        <div className="grid gap-3 rounded-lg border border-brand/30 bg-brand-soft/40 p-3 sm:grid-cols-2">
          <label className="text-sm font-bold text-ink">Preço promocional (R$) — campanha
            <input value={promoReais} onChange={(e) => setPromoReais(e.target.value)} inputMode="decimal" placeholder="vazio = sem promoção" className="mt-1 w-full rounded-lg border border-border bg-bg px-4 py-2 font-normal text-foreground" />
          </label>
          <label className="text-sm font-bold text-ink">Promoção válida até (opcional)
            <input type="datetime-local" value={promoEndsAt} onChange={(e) => setPromoEndsAt(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-bg px-4 py-2 font-normal text-foreground" />
          </label>
          <span className="text-xs font-normal text-muted sm:col-span-2">Preço promocional menor que o normal coloca o curso em promoção (preço riscado + selo, e cobra o promocional). Data vazia = promoção sem prazo.</span>
        </div>
        <CoverField
          courseId={course.id}
          coverImageUrl={coverImageUrl}
          coverFocus={coverFocus}
          onChange={(p) => {
            if ('coverImageUrl' in p) setCoverImageUrl(p.coverImageUrl ?? null)
            if ('coverFocus' in p) setCoverFocus(p.coverFocus ?? null)
          }}
        />
        {isPlatformAdmin && (
          <label className="flex items-start gap-3 rounded-lg border border-border bg-bg/40 p-3 text-sm text-ink">
            <input type="checkbox" checked={tutorEnabled} onChange={(e) => setTutorEnabled(e.target.checked)} className="mt-1 size-4 accent-brand" />
            <span>
              <span className="font-bold">Tutor de voz com IA na sala de aula</span>
              <span className="mt-1 block text-xs text-muted">Os alunos tiram dúvidas e revisam os módulos por voz, com base nas apostilas em PDF anexadas às aulas. Cada aluno tem até 1 hora por mês, no máximo 30 minutos por dia. Cada pergunta tem custo de uso da IA para o Studio Pilari.</span>
            </span>
          </label>
        )}
        {isAdmin && (
          <div className="grid gap-3 rounded-lg border border-border bg-bg/40 p-3 sm:grid-cols-2">
            <label className="text-sm font-bold text-ink">Coordenador(a) do curso — assina o certificado
              <input value={coordName} onChange={(e) => setCoordName(e.target.value)} disabled={locked} placeholder="vazio = só a assinatura da Diretora" className="mt-1 w-full rounded-lg border border-border bg-bg px-4 py-2 font-normal text-foreground disabled:cursor-not-allowed disabled:opacity-60" />
            </label>
            <label className="text-sm font-bold text-ink">Cargo impresso
              <input value={coordRole} onChange={(e) => setCoordRole(e.target.value)} disabled={locked} className="mt-1 w-full rounded-lg border border-border bg-bg px-4 py-2 font-normal text-foreground disabled:cursor-not-allowed disabled:opacity-60" />
            </label>
            <div className="sm:col-span-2">
              <span className="text-sm font-bold text-ink">Assinatura (imagem da rubrica)</span>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <div className="grid h-20 w-56 place-items-center overflow-hidden rounded-lg border border-border bg-white">
                  {coordSigPreview ?? coordSig ? (
                    <img
                      src={coordSigPreview ?? `/api/instructor/courses/${course.id}/signature`}
                      alt="Rubrica do coordenador"
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <span className="px-2 text-center text-xs text-muted">Sem rubrica — só o nome sai impresso</span>
                  )}
                </div>
                {!locked && (
                  <FileUploadButton
                    kind="signature"
                    courseId={course.id}
                    accept="image/png,image/jpeg,image/webp"
                    label={coordSig ? 'Trocar rubrica' : 'Enviar rubrica'}
                    onDone={(objectPath, file) => {
                      setCoordSig(objectPath)
                      setCoordSigPreview((old) => {
                        if (old) URL.revokeObjectURL(old)
                        return URL.createObjectURL(file)
                      })
                    }}
                  />
                )}
                {coordSig && !locked && (
                  <button
                    type="button"
                    onClick={() => { setCoordSig(null); setCoordSigPreview(null) }}
                    className="cursor-pointer text-sm text-red-500 hover:underline"
                  >
                    Remover
                  </button>
                )}
              </div>
              <span className="mt-1 block text-xs font-normal text-muted">
                Pode mandar como veio (foto, print ou scan): o <strong>fundo branco é removido automaticamente</strong>
                e a imagem é recortada na assinatura. O preview já mostra o resultado final. Só vale depois de{' '}
                <strong>Salvar</strong>.
              </span>
            </div>
            <span className="text-xs font-normal text-muted sm:col-span-2">Sai como 2ª assinatura, ao lado da Diretora. Certificados já emitidos guardam quem assinou na época e não mudam.</span>
          </div>
        )}
        <label className="text-sm font-bold text-ink">Carga horária do certificado (horas)
          <input
            value={carga}
            onChange={(e) => setCarga(e.target.value)}
            disabled={locked}
            inputMode="numeric"
            placeholder="vazio = soma a duração das aulas"
            className="mt-1 w-full rounded-lg border border-border bg-bg px-4 py-2 font-normal text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          />
          {/* A carga declarada raramente é igual ao tempo de vídeo: 180h de curso não são
              180h de aula gravada. Por isso o campo existe e vence a soma. */}
          <span className="mt-1 block text-xs font-normal text-muted">
            É o número impresso no certificado. Deixando vazio, o sistema soma a duração das aulas — que
            costuma ser bem menor que a carga declarada do curso. Corrigir aqui atualiza os certificados já
            emitidos.
          </span>
        </label>
        <label className="text-sm font-bold text-ink">Data de liberação (pré-venda)
          <input type="datetime-local" value={availableAt} onChange={(e) => setAvailableAt(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-bg px-4 py-2 font-normal text-foreground" />
          <span className="mt-1 block text-xs font-normal text-muted">Deixe vazio para liberar imediatamente. Com data futura, o curso pode ser comprado agora (pré-venda), mas o conteúdo só abre na data.</span>
        </label>
        <button
          type="button"
          onClick={() => saveMutation.mutate(omitLockedFields({
            title, subtitle: subtitle || null, description: description || null,
            categoryId: categoryId || null, priceInCents: Math.round(Number(priceReais.replace(',', '.')) * 100) || 0,
            promoPriceInCents: promoReais.trim() ? Math.round(Number(promoReais.replace(',', '.')) * 100) : null,
            promoEndsAt: promoEndsAt ? new Date(promoEndsAt).toISOString() : null,
            coverImageUrl: coverImageUrl || null,
            coverFocus: coverFocus || null,
            availableAt: availableAt ? new Date(availableAt).toISOString() : null,
            coordinatorName: coordName.trim() || null,
            coordinatorRole: coordName.trim() ? coordRole.trim() || null : null,
            coordinatorSignaturePath: coordName.trim() ? coordSig : null,
            workloadHours: carga.trim() ? Number(carga.replace(/\D+/g, '')) || null : null,
            ...(isPlatformAdmin ? { tutorEnabled } : {}),
          }, locked))}
          disabled={saveMutation.isPending}
          className="mt-1 self-start rounded-full bg-brand px-5 py-2 font-bold text-white disabled:opacity-60"
        >
          {saveMutation.isPending ? 'Salvando…' : 'Salvar'}
        </button>
        {saveMutation.isError && <p className="text-sm text-red-500">{apiMessage(saveMutation.error, 'Erro ao salvar.')}</p>}
      </section>
    </>
  )
}

export function CourseEditorPage() {
  const { id } = useParams()
  const courseId = id ?? ''
  const courseQuery = useInstructorCourseQuery(courseId)
  const course = courseQuery.data

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <Link to="/instrutor" className="inline-flex items-center gap-2 text-sm font-medium text-accent hover:text-brand-bright">
        <ArrowLeft className="size-4" aria-hidden="true" /> Meus cursos
      </Link>

      {course ? (
        <>
          <MetaForm key={metaFormKey(course)} course={course} refetch={() => void courseQuery.refetch()} />
          <Curriculum courseId={courseId} />
          <AnnouncementsManager courseId={courseId} />
        </>
      ) : (
        <p className="mt-8 text-muted">Carregando curso…</p>
      )}
    </div>
  )
}
