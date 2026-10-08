import { useMemo, useState } from 'react'
import { AlertTriangle, Download, ExternalLink, Plus, Search, Trash2, User } from 'lucide-react'
import type { AdminOrderRow } from '@pilari/types'
import {
  carneAdminPath,
  useCancelChargeMutation,
  useCreateChargeMutation,
  useStudentFinanceQuery,
  useStudentSearchQuery,
} from '@/entities/admin-billing'
import { useAdminCoursesQuery } from '@/entities/admin-dashboard'
import { downloadPdfAuth } from '@/entities/my-account'

/** Mensagem do servidor, com o mesmo formato usado nas outras telas do admin. */
function apiMessage(error: unknown, fallback: string): string {
  const msg = (error as { response?: { data?: { message?: string | string[] } } } | null)?.response?.data?.message
  if (Array.isArray(msg)) return msg.join(' ')
  return msg ?? fallback
}

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBr = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—')

const btn =
  'inline-flex cursor-pointer items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60'
const btnGhost =
  'inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-60'

/** Financeiro por aluno: busca, ficha, criação de cobrança e download do carnê. */
export function FinanceiroDoAluno() {
  const [busca, setBusca] = useState('')
  const [alunoId, setAlunoId] = useState<string | null>(null)
  // Abrir o formulário no mesmo clique: o caminho antigo era buscar → abrir a ficha →
  // achar o botão, e o campo de vencimento ficava três passos dentro da tela.
  const [jaCobrando, setJaCobrando] = useState(false)
  const resultados = useStudentSearchQuery(busca)

  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-5">
      <h3 className="text-lg font-bold text-ink">Financeiro do aluno</h3>
      <p className="mt-1 text-sm text-muted">
        Busque o aluno e clique em <strong>Cobrar</strong> para criar uma cobrança (com valor, forma e
        vencimento), ou no nome dele para ver tudo que deve e já pagou e baixar o carnê.
      </p>

      <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2">
        <Search className="size-4 shrink-0 text-muted" aria-hidden="true" />
        <input
          value={busca}
          onChange={(e) => {
            setBusca(e.target.value)
            setAlunoId(null)
            setJaCobrando(false)
          }}
          placeholder="Nome, e-mail ou CPF (mínimo 3 caracteres)"
          className="w-full bg-transparent text-sm text-foreground outline-none"
        />
      </div>

      {!alunoId && resultados.data && resultados.data.length > 0 && (
        <ul className="mt-2 flex flex-col gap-0.5">
          {resultados.data.map((a) => (
            <li key={a.uid} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-brand-soft/50">
              <button
                type="button"
                onClick={() => {
                  setAlunoId(a.uid)
                  setJaCobrando(false)
                }}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
              >
                <User className="size-4 shrink-0 text-brand" aria-hidden="true" />
                <span className="text-sm font-bold text-ink">{a.name ?? '(sem nome)'}</span>
                <span className="truncate text-xs text-muted">{a.email}</span>
                {!a.cpf && <span className="shrink-0 text-[11px] text-amber-600">sem CPF</span>}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAlunoId(a.uid)
                  setJaCobrando(true)
                }}
                className="shrink-0 cursor-pointer rounded-full bg-brand px-3 py-1 text-xs font-bold text-white hover:bg-brand-dark"
              >
                Cobrar
              </button>
            </li>
          ))}
        </ul>
      )}
      {!alunoId && resultados.data?.length === 0 && busca.trim().length >= 3 && (
        <p className="mt-2 text-sm text-muted">Nenhum aluno encontrado.</p>
      )}

      {alunoId && (
        <FichaDoAluno
          key={alunoId}
          uid={alunoId}
          abrirCobranca={jaCobrando}
          onTrocar={() => {
            setAlunoId(null)
            setJaCobrando(false)
          }}
        />
      )}
    </section>
  )
}

function FichaDoAluno({
  uid,
  abrirCobranca,
  onTrocar,
}: {
  uid: string
  abrirCobranca: boolean
  onTrocar: () => void
}) {
  const { data, isLoading, isError } = useStudentFinanceQuery(uid)
  // `key={uid}` no pai remonta ao trocar de aluno, então o estado inicial vale de novo —
  // é o que substitui um efeito de sincronização (useEffect é proibido no projeto).
  const [criando, setCriando] = useState(abrirCobranca)

  if (isLoading) return <p className="mt-4 text-sm text-muted">Carregando ficha…</p>
  if (isError || !data) return <p className="mt-4 text-sm text-red-500">Não foi possível carregar a ficha.</p>

  const { student } = data
  const semCpf = !student.cpf

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg/40 p-3">
        <div>
          <p className="font-bold text-ink">{student.name ?? '(sem nome)'}</p>
          <p className="text-xs text-muted">
            {student.email} {student.cpf ? `· CPF ${student.cpf}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted">
            em aberto <strong className="text-amber-600">{brl(data.totalPendingInCents)}</strong>
          </span>
          <span className="text-muted">
            pago <strong className="text-green-600">{brl(data.totalPaidInCents)}</strong>
          </span>
          <button type="button" onClick={onTrocar} className="cursor-pointer text-xs text-muted hover:underline">
            trocar aluno
          </button>
        </div>
      </div>

      {semCpf && (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {/* O Asaas exige CPF no cliente; sem isto o erro só apareceria lá, como 400 opaco. */}
          Este aluno não tem CPF cadastrado. O Asaas exige CPF para emitir cobrança — você informa no formulário e
          ele fica salvo no cadastro.
        </p>
      )}

      {!criando && (
        <button type="button" onClick={() => setCriando(true)} className={`${btn} mt-3`}>
          <Plus className="size-4" aria-hidden="true" /> Nova cobrança
        </button>
      )}
      {criando && <FormularioCobranca uid={uid} precisaCpf={semCpf} onPronto={() => setCriando(false)} />}

      <h4 className="mt-5 text-sm font-bold text-ink">Cobranças</h4>
      {data.orders.length === 0 ? (
        <p className="mt-1 text-sm text-muted">Este aluno ainda não tem nenhuma cobrança.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {data.orders.map((o) => (
            <LinhaDoPedido key={o.id} o={o} />
          ))}
        </ul>
      )}
    </div>
  )
}

const CORES: Record<string, string> = {
  paid: 'bg-green-100 text-green-700',
  pending: 'bg-amber-100 text-amber-700',
  canceled: 'bg-neutral-200 text-neutral-600',
  refunded: 'bg-red-100 text-red-700',
}

function LinhaDoPedido({ o }: { o: AdminOrderRow }) {
  const [baixando, setBaixando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const cancelar = useCancelChargeMutation()
  const pagas = o.installments.filter((p) => p.status === 'paid').length
  // O discriminador de carnê é o plano de parcelamento, não o modo escolhido no carrinho.
  const ehCarne = o.installments.length > 0

  const baixarCarne = async () => {
    setErro(null)
    setBaixando(true)
    try {
      await downloadPdfAuth(carneAdminPath(o.id), `carne-${o.id.slice(0, 8)}.pdf`)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao baixar.')
    } finally {
      setBaixando(false)
    }
  }

  return (
    <li className="rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${CORES[o.status] ?? CORES.canceled}`}>
          {o.status}
        </span>
        <span className="font-bold text-ink">{brl(o.totalInCents)}</span>
        <span className="text-sm text-foreground">
          {o.courseTitles.length > 0 ? o.courseTitles.join(' + ') : (o.description ?? '(sem descrição)')}
        </span>
        {o.createdByAdmin && (
          <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-bold text-brand">pelo admin</span>
        )}
        <span className="ml-auto text-xs text-muted">criada em {dataBr(o.createdAt)}</span>
      </div>

      {ehCarne && (
        <p className="mt-1 text-xs text-muted">
          Carnê de {o.installments.length}x · <strong>{pagas} paga(s)</strong> · vence dia{' '}
          {o.installments[0]?.dueDate ?? '—'}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {ehCarne && (
          <button type="button" onClick={() => void baixarCarne()} disabled={baixando} className={btnGhost}>
            <Download className="size-3.5" aria-hidden="true" /> {baixando ? 'Baixando…' : 'Baixar carnê'}
          </button>
        )}
        {o.paymentUrl && (
          <a href={o.paymentUrl} target="_blank" rel="noreferrer" className={btnGhost}>
            <ExternalLink className="size-3.5" aria-hidden="true" /> Abrir fatura no Asaas
          </a>
        )}
        {/* Só pedido em aberto: pago vira estorno, e isso se resolve no Asaas. */}
        {o.status === 'pending' &&
          (confirmando ? (
            <span className="inline-flex items-center gap-2 rounded-lg border border-red-300 px-2 py-1">
              <span className="text-xs text-red-600">Cancelar? O boleto é apagado no Asaas.</span>
              <button
                type="button"
                disabled={cancelar.isPending}
                onClick={() => cancelar.mutate(o.id, { onSettled: () => setConfirmando(false) })}
                className="cursor-pointer text-xs font-bold text-red-600 hover:underline disabled:opacity-60"
              >
                {cancelar.isPending ? 'Cancelando…' : 'Sim'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmando(false)}
                className="cursor-pointer text-xs text-muted hover:underline"
              >
                não
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmando(true)} className={btnGhost}>
              <Trash2 className="size-3.5" aria-hidden="true" /> Cancelar cobrança
            </button>
          ))}
      </div>
      {cancelar.isError && <p className="mt-1 text-xs text-red-500">{apiMessage(cancelar.error, 'Falha ao cancelar.')}</p>}
      {erro && <p className="mt-1 text-xs text-red-500">{erro}</p>}
    </li>
  )
}

function FormularioCobranca({ uid, precisaCpf, onPronto }: { uid: string; precisaCpf: boolean; onPronto: () => void }) {
  const cursosQuery = useAdminCoursesQuery()
  const criar = useCreateChargeMutation()
  const [tipo, setTipo] = useState<'curso' | 'avulsa'>('curso')
  const [cursoId, setCursoId] = useState('')
  const [descricao, setDescricao] = useState('')
  const [valor, setValor] = useState('')
  const [parcelas, setParcelas] = useState(1)
  const [cpf, setCpf] = useState('')
  const [matricularJa, setMatricularJa] = useState(false)
  const [vencimento, setVencimento] = useState('')
  const [confirmando, setConfirmando] = useState(false)

  const cursos = useMemo(
    () => [...(cursosQuery.data ?? [])].sort((a, b) => a.title.localeCompare(b.title, 'pt-BR')),
    [cursosQuery.data]
  )
  const curso = cursos.find((c) => c.id === cursoId)
  const centavos =
    tipo === 'curso' ? (curso?.priceInCents ?? 0) : Math.round(Number(valor.replace(',', '.')) * 100) || 0
  const cpfOk = !precisaCpf || cpf.replace(/\D+/g, '').length === 11
  const podeCriar =
    centavos > 0 && cpfOk && (tipo === 'curso' ? !!cursoId : descricao.trim().length > 0) && !criar.isPending

  const enviar = () =>
    criar.mutate(
      {
        userId: uid,
        courseIds: tipo === 'curso' ? [cursoId] : [],
        description: tipo === 'avulsa' ? descricao.trim() : undefined,
        amountInCents: tipo === 'avulsa' ? centavos : undefined,
        installmentCount: parcelas,
        cpf: precisaCpf ? cpf : undefined,
        dueDate: vencimento || undefined,
        enrollNow: tipo === 'curso' ? matricularJa : undefined,
      },
      { onSuccess: onPronto }
    )

  return (
    <div className="mt-3 rounded-xl border border-brand/40 bg-brand-soft/30 p-4">
      <div className="flex gap-4 text-sm font-bold text-ink">
        {(['curso', 'avulsa'] as const).map((t) => (
          <label key={t} className="flex cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              checked={tipo === t}
              onChange={() => {
                setTipo(t)
                setConfirmando(false)
              }}
            />
            {t === 'curso' ? 'Curso' : 'Valor livre'}
          </label>
        ))}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {tipo === 'curso' ? (
          <label className="text-sm font-bold text-ink sm:col-span-2">
            Curso
            <select
              value={cursoId}
              onChange={(e) => {
                setCursoId(e.target.value)
                setConfirmando(false)
              }}
              className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 font-normal text-foreground"
            >
              <option value="">— escolha —</option>
              {cursos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} — {brl(c.priceInCents)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label className="text-sm font-bold text-ink">
              Descrição
              <input
                value={descricao}
                onChange={(e) => {
                  setDescricao(e.target.value)
                  setConfirmando(false)
                }}
                placeholder="Ex.: Taxa de segunda via"
                className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 font-normal text-foreground"
              />
            </label>
            <label className="text-sm font-bold text-ink">
              Valor (R$)
              <input
                value={valor}
                onChange={(e) => {
                  setValor(e.target.value)
                  setConfirmando(false)
                }}
                inputMode="decimal"
                className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 font-normal text-foreground"
              />
            </label>
          </>
        )}

        {precisaCpf && (
          <label className="text-sm font-bold text-ink">
            CPF do aluno
            <input
              value={cpf}
              onChange={(e) => {
                setCpf(e.target.value)
                setConfirmando(false)
              }}
              inputMode="numeric"
              placeholder="000.000.000-00"
              className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 font-normal text-foreground"
            />
            <span className="mt-1 block text-xs font-normal text-muted">Fica salvo no cadastro dele.</span>
          </label>
        )}

        <label className="text-sm font-bold text-ink">
          Vencimento
          <input
            type="date"
            value={vencimento}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => {
              setVencimento(e.target.value)
              setConfirmando(false)
            }}
            className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 font-normal text-foreground"
          />
          {/* No carnê o Asaas espaça as demais de 30 em 30 a partir desta. */}
          <span className="mt-1 block text-xs font-normal text-muted">
            {parcelas > 1 ? 'Da 1ª parcela; as outras seguem de mês em mês.' : 'Vazio = 3 dias a partir de hoje.'}
          </span>
        </label>

        <label className="text-sm font-bold text-ink">
          Forma
          <select
            value={parcelas}
            onChange={(e) => {
              setParcelas(Number(e.target.value))
              setConfirmando(false)
            }}
            className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 font-normal text-foreground"
          >
            <option value={1}>À vista (boleto/PIX)</option>
            {[2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                Carnê {n}x{centavos > 0 ? ` de ${brl(Math.floor(centavos / n))}` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      {tipo === 'curso' && (
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={matricularJa}
            onChange={(e) => {
              setMatricularJa(e.target.checked)
              setConfirmando(false)
            }}
            className="mt-0.5"
          />
          <span>
            <strong>Liberar o acesso agora</strong>, sem esperar o pagamento
            <span className="block text-xs font-normal text-muted">
              Para o aluno começar a estudar enquanto paga. Sem marcar, o acesso abre sozinho quando o
              pagamento entrar.
            </span>
          </span>
        </label>
      )}

      {/*
        Confirmação em dois passos: este botão emite BOLETO DE VERDADE no Asaas e o aluno
        recebe por e-mail. Não existe desfazer — cancelar depois deixa rastro para ele.
      */}
      {!confirmando ? (
        <div className="mt-3 flex items-center gap-3">
          <button type="button" onClick={() => setConfirmando(true)} disabled={!podeCriar} className={btn}>
            Revisar e criar
          </button>
          <button type="button" onClick={onPronto} className="cursor-pointer text-sm text-muted hover:underline">
            Cancelar
          </button>
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-amber-400 bg-amber-50 p-3">
          <p className="flex items-start gap-2 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              Vai emitir <strong>cobrança real</strong> de <strong>{brl(centavos)}</strong>
              {parcelas > 1 ? ` em ${parcelas}x de ${brl(Math.floor(centavos / parcelas))}` : ' à vista'} para{' '}
              <strong>{tipo === 'curso' ? curso?.title : descricao}</strong>. O aluno recebe o boleto por e-mail.
              {vencimento && ` Vence em ${new Date(vencimento + 'T12:00:00').toLocaleDateString('pt-BR')}.`}
              {tipo === 'avulsa' && ' Pagar NÃO libera curso nenhum.'}
              {tipo === 'curso' && matricularJa && ' O acesso é liberado IMEDIATAMENTE, antes de pagar.'}
            </span>
          </p>
          <div className="mt-2 flex items-center gap-3">
            <button type="button" onClick={enviar} disabled={criar.isPending} className={btn}>
              {criar.isPending ? 'Criando…' : 'Confirmar e emitir'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmando(false)}
              className="cursor-pointer text-sm text-muted hover:underline"
            >
              voltar
            </button>
          </div>
        </div>
      )}
      {criar.isError && <p className="mt-2 text-sm text-red-500">{apiMessage(criar.error, 'Falha ao criar.')}</p>}
    </div>
  )
}
