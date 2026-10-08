import { useCallback, useReducer, useRef, useState, type FormEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Keyboard, RotateCcw, Send } from 'lucide-react'
import { falarTutor, mensagemDoErro, perguntarTutor, useTutorInfoQuery } from '@/entities/tutor'
import { bytesParaBase64 } from '../lib/audio-codec'
import { estadoInicial, faseApos, reduzirTutor, saldoDoTutor, textoDaFase, type EventoTutor } from '../lib/tutor-state'
import { iniciarGravacao, type Gravacao } from '../audio/gravador'
import { tocarFluxo, type Reproducao } from '../audio/tocador'
import { TutorOrb, type SinaisDaEsfera } from './TutorOrb'

const AVISO_LIDO = 'tutor-aviso-privacidade'
const PEDIDO_REVISAO = 'Quero revisar este módulo. Me faça uma pergunta por vez e comente a minha resposta.'

function avisoJaLido(): boolean {
  try {
    return localStorage.getItem(AVISO_LIDO) === '1'
  } catch {
    return false
  }
}

export function TutorPage() {
  const { slug = '' } = useParams()
  const [params] = useSearchParams()
  const qc = useQueryClient()
  const info = useTutorInfoQuery(slug)
  const [estado, despachar] = useReducer(reduzirTutor, estadoInicial)
  const [moduloEscolhido, setModuloEscolhido] = useState<string | null>(params.get('modulo'))
  const [digitando, setDigitando] = useState(false)
  const [texto, setTexto] = useState('')
  const [mostrarAviso, setMostrarAviso] = useState(() => !avisoJaLido())
  const [usados, setUsados] = useState<{ dia: number; mes: number } | null>(null)
  // Volume e fase lidos pela esfera a cada quadro: objeto estável, atualizado só nos handlers.
  const [sinais] = useState<SinaisDaEsfera>(() => ({ fase: 'pronto', nivel: () => 0 }))
  const gravacao = useRef<Gravacao | null>(null)
  const reproducao = useRef<Reproducao | null>(null)
  const falaEmCurso = useRef<AbortController | null>(null)
  const saida = useRef<AudioContext | null>(null)

  const modulos = info.data?.modulos ?? []
  const modulo = modulos.find((m) => m.id === moduloEscolhido) ?? modulos.find((m) => m.temMaterial) ?? modulos[0] ?? null
  // O uso só cresce: vale o maior entre o da última pergunta e o da consulta (que já inclui a voz).
  const uso = {
    usadosHoje: Math.max(usados?.dia ?? 0, info.data?.usadosHoje ?? 0),
    limiteDia: info.data?.limiteSegundos ?? 1800,
    usadosMes: Math.max(usados?.mes ?? 0, info.data?.usadosNoMes ?? 0),
    limiteMes: info.data?.limiteMensalSegundos ?? 3600,
  }

  const enviar = useCallback(
    (e: EventoTutor) => {
      sinais.fase = faseApos(e)
      if (sinais.fase !== 'ouvindo' && sinais.fase !== 'falando') sinais.nivel = () => 0
      despachar(e)
    },
    [sinais]
  )

  const pararTudo = useCallback(() => {
    gravacao.current?.cancelar()
    gravacao.current = null
    falaEmCurso.current?.abort()
    falaEmCurso.current = null
    reproducao.current?.parar()
    reproducao.current = null
  }, [])

  // Sair da página (voltar, trocar de rota) desliga o microfone e a voz: callback de ref com limpeza, sem useEffect.
  const raiz = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return
      // Rota fora do layout: o ScrollToTop do RootLayout não roda aqui, e a página herdaria a rolagem da aula.
      window.scrollTo({ top: 0 })
      return () => {
        pararTudo()
        void saida.current?.close()
        saida.current = null
      }
    },
    [pararTudo]
  )

  /** O Safari só libera áudio criado dentro de um toque: o contexto de saída nasce aqui e é reaproveitado. */
  function prepararSaida(): AudioContext {
    if (!saida.current || saida.current.state === 'closed') saida.current = new AudioContext()
    void saida.current.resume()
    return saida.current
  }

  async function falar(resposta: string) {
    const ctx = prepararSaida()
    const parar = new AbortController()
    falaEmCurso.current = parar
    try {
      const r = await falarTutor(slug, resposta, parar.signal)
      if (parar.signal.aborted) return
      const tocando = tocarFluxo(ctx, r)
      reproducao.current = tocando
      sinais.nivel = tocando.nivel
      await tocando.terminou
      if (reproducao.current === tocando) {
        reproducao.current = null
        enviar({ tipo: 'falou' })
      }
    } catch (err) {
      if (parar.signal.aborted) return
      // A resposta em texto já está na tela: a falha da voz não apaga a resposta.
      enviar({ tipo: 'falou' })
      console.warn('tutor: falha na voz', err)
    } finally {
      if (falaEmCurso.current === parar) falaEmCurso.current = null
      void qc.invalidateQueries({ queryKey: ['tutor', slug] })
    }
  }

  async function perguntar(conteudo: { audioWavBase64?: string; texto?: string }) {
    if (!modulo) return
    enviar({ tipo: 'pensar', pergunta: conteudo.texto })
    try {
      const r = await perguntarTutor(slug, { moduleId: modulo.id, historico: estado.historico, ...conteudo })
      setUsados({ dia: r.usadosHoje, mes: r.usadosNoMes })
      enviar({ tipo: 'responder', pergunta: r.transcricao, resposta: r.resposta })
      await falar(r.resposta)
    } catch (err) {
      enviar({ tipo: 'falhar', mensagem: mensagemDoErro(err) })
    }
  }

  async function ouvir() {
    prepararSaida()
    let g: Gravacao
    try {
      g = await iniciarGravacao()
    } catch {
      enviar({ tipo: 'falhar', mensagem: 'Permita o uso do microfone para conversar por voz, ou toque em "Digitar".' })
      return
    }
    gravacao.current = g
    sinais.nivel = g.nivel
    enviar({ tipo: 'ouvir' })
    const pergunta = await g.resultado
    if (gravacao.current !== g) return
    gravacao.current = null
    if (!pergunta) {
      enviar({ tipo: 'falhar', mensagem: 'Não ouvi nada. Toque na esfera e fale de novo.' })
      return
    }
    await perguntar({ audioWavBase64: bytesParaBase64(pergunta.wav) })
  }

  function tocarEsfera() {
    switch (sinais.fase) {
      case 'ouvindo':
        gravacao.current?.parar()
        return
      case 'falando':
        pararTudo()
        enviar({ tipo: 'interromper' })
        return
      case 'pensando':
        return
      default:
        void ouvir()
    }
  }

  function enviarTexto(e: FormEvent) {
    e.preventDefault()
    const t = texto.trim()
    if (!t || sinais.fase === 'pensando') return
    pararTudo()
    setTexto('')
    void perguntar({ texto: t })
  }

  function revisar() {
    if (sinais.fase === 'pensando') return
    pararTudo()
    void perguntar({ texto: PEDIDO_REVISAO })
  }

  function trocarModulo(id: string) {
    if (id === modulo?.id) return
    pararTudo()
    setModuloEscolhido(id)
    enviar({ tipo: 'trocarModulo' })
  }

  function fecharAviso() {
    setMostrarAviso(false)
    try {
      localStorage.setItem(AVISO_LIDO, '1')
    } catch {
      // modo privado: o aviso volta na próxima visita, sem problema
    }
  }

  if (info.isLoading) return <div className="grid min-h-dvh place-items-center bg-bg text-muted">Preparando o tutor…</div>

  // Sem acesso, ou com o teto mensal da plataforma atingido: a página já abre explicando, antes de o aluno falar.
  if (info.isError || !info.data || info.data.pausa) {
    return (
      <div className="grid min-h-dvh place-items-center bg-bg px-4 text-center">
        <div className="max-w-md">
          <p className="text-lg text-ink">{info.data?.pausa ?? mensagemDoErro(info.error, 'O tutor não está disponível neste curso.')}</p>
          <Link to={`/aprender/${slug}`} className="mt-6 inline-flex items-center gap-2 font-medium text-accent">
            <ArrowLeft className="size-4" aria-hidden="true" /> Voltar para a aula
          </Link>
        </div>
      </div>
    )
  }

  const saldo = saldoDoTutor(uso)

  return (
    <div ref={raiz} className="flex min-h-dvh flex-col bg-bg px-4 pb-6 text-ink">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 py-4">
        <Link to={`/aprender/${slug}`} className="inline-flex items-center gap-2 text-sm font-medium text-muted hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden="true" /> Voltar para a aula
        </Link>
        <span className="rounded-full border border-border px-3 py-1 text-xs text-muted" title="Conversa com o tutor: até 30 minutos por dia e a cota do mês">
          {saldo.rotulo}
        </span>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center gap-5">
        <div className="text-center">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">Tutor de voz · {info.data.cursoTitulo}</p>
          <h1 className="mt-1 text-xl font-bold text-balance">{modulo ? `Revisando o ${modulo.titulo}` : 'Tutor de voz'}</h1>
        </div>

        <nav aria-label="Módulo para revisar" className="flex max-w-full gap-2 overflow-x-auto pb-1">
          {modulos.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => trocarModulo(m.id)}
              aria-pressed={m.id === modulo?.id}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                m.id === modulo?.id ? 'border-blue-500 bg-blue-500 text-white' : 'border-border text-muted hover:text-ink'
              }`}
            >
              {m.titulo}
            </button>
          ))}
        </nav>

        <div className="flex w-full flex-1 flex-col items-center justify-center gap-4 py-2">
          <TutorOrb sinais={sinais} onToque={tocarEsfera} rotulo={textoDaFase(estado.fase, estado.erro)} />
          <p role="status" aria-live="polite" className={`min-h-6 text-center text-sm ${estado.fase === 'erro' ? 'text-danger' : 'text-muted'}`}>
            {textoDaFase(estado.fase, estado.erro)}
          </p>
          {modulo && !modulo.temMaterial && (
            <p className="max-w-md text-center text-xs text-muted">Este módulo ainda não tem apostila: a tutora responde de forma geral.</p>
          )}
        </div>

        {(estado.ultimaPergunta || estado.ultimaResposta) && (
          <section aria-label="Última conversa" className="w-full max-w-2xl space-y-3 text-left">
            {estado.ultimaPergunta && (
              <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-surface px-4 py-2 text-sm">
                <span className="sr-only">Você: </span>
                {estado.ultimaPergunta}
              </p>
            )}
            {estado.ultimaResposta && (
              <p className="max-w-[85%] rounded-2xl rounded-bl-sm border border-border bg-card px-4 py-3 text-[15px] leading-relaxed">
                <span className="sr-only">Tutora: </span>
                {estado.ultimaResposta}
              </p>
            )}
          </section>
        )}

        {mostrarAviso && (
          <div className="w-full max-w-2xl rounded-2xl border border-border bg-card p-4 text-sm text-muted">
            <p>
              Sua pergunta é enviada à inteligência artificial do Google (Gemini) só para gerar a resposta. O áudio não é gravado. A tutora
              responde com base na apostila do módulo e pode errar: na dúvida, confira o material e fale com o seu professor.
            </p>
            <button type="button" onClick={fecharAviso} className="mt-2 font-medium text-accent">
              Entendi
            </button>
          </div>
        )}

        <div className="flex w-full max-w-2xl flex-col gap-3">
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" onClick={revisar} disabled={estado.fase === 'pensando'} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-surface disabled:opacity-50">
              <RotateCcw className="size-4" aria-hidden="true" /> Revisar este módulo
            </button>
            <button type="button" onClick={() => setDigitando((d) => !d)} aria-expanded={digitando} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-surface">
              <Keyboard className="size-4" aria-hidden="true" /> {digitando ? 'Fechar teclado' : 'Digitar'}
            </button>
          </div>
          {digitando && (
            <form onSubmit={enviarTexto} className="flex gap-2">
              <label htmlFor="tutor-texto" className="sr-only">
                Sua pergunta
              </label>
              <input
                id="tutor-texto"
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                maxLength={1000}
                placeholder="Digite sua dúvida sobre o módulo…"
                className="min-w-0 flex-1 rounded-full border border-border bg-card px-4 py-2 text-sm outline-none focus:border-blue-500"
              />
              <button type="submit" disabled={!texto.trim() || estado.fase === 'pensando'} aria-label="Enviar pergunta" className="grid size-10 place-items-center rounded-full bg-blue-500 text-white disabled:opacity-50">
                <Send className="size-4" aria-hidden="true" />
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  )
}
