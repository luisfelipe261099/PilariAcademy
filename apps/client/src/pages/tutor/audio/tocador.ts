import { pcm16ParaFloat } from '../lib/audio-codec'

const TAXA_VOZ = 24000

export interface Reproducao {
  /** Volume atual de 0 a 1, para animar a esfera com a voz da tutora. */
  nivel(): number
  parar(): void
  /** Resolve quando o último pedaço termina de tocar (ou quando parar() é chamado). */
  terminou: Promise<void>
}

/**
 * Toca o PCM da resposta à medida que chega: cada pedaço vira um AudioBuffer agendado logo depois do anterior.
 * Recebe o AudioContext criado no toque do aluno, porque o Safari só libera áudio iniciado num gesto.
 */
export function tocarFluxo(ctx: AudioContext, resposta: Response): Reproducao {
  const analisador = ctx.createAnalyser()
  analisador.fftSize = 512
  analisador.connect(ctx.destination)
  const amostras = new Float32Array(analisador.fftSize)
  const fontes: AudioBufferSourceNode[] = []
  const leitor = resposta.body?.getReader()
  let proximoInicio = 0
  let parado = false
  let fluxoAcabou = false
  let pendentes = 0
  let resolver!: () => void
  const terminou = new Promise<void>((ok) => (resolver = ok))

  function talvezTerminar() {
    if (fluxoAcabou && pendentes === 0) resolver()
  }

  function agendar(dados: Float32Array) {
    if (!dados.length || parado) return
    const buf = ctx.createBuffer(1, dados.length, TAXA_VOZ)
    buf.copyToChannel(new Float32Array(dados), 0)
    const fonte = ctx.createBufferSource()
    fonte.buffer = buf
    fonte.connect(analisador)
    const inicio = Math.max(ctx.currentTime + 0.05, proximoInicio)
    fonte.start(inicio)
    proximoInicio = inicio + buf.duration
    pendentes++
    fonte.onended = () => {
      pendentes--
      talvezTerminar()
    }
    fontes.push(fonte)
  }

  void (async () => {
    if (!leitor) {
      fluxoAcabou = true
      return talvezTerminar()
    }
    let sobra: Uint8Array | null = null
    try {
      for (;;) {
        const { done, value } = await leitor.read()
        if (done || parado) break
        const r = pcm16ParaFloat(value, sobra)
        sobra = r.sobra
        agendar(r.amostras)
      }
    } catch {
      // fluxo interrompido (parar() ou rede): toca o que já chegou
    }
    fluxoAcabou = true
    talvezTerminar()
  })()

  return {
    nivel() {
      analisador.getFloatTimeDomainData(amostras)
      let soma = 0
      for (const a of amostras) soma += a * a
      return Math.min(1, Math.sqrt(soma / amostras.length) * 5)
    },
    parar() {
      if (parado) return
      parado = true
      void leitor?.cancel().catch(() => undefined)
      for (const f of fontes) {
        try {
          f.stop()
        } catch {
          // já tinha terminado
        }
      }
      resolver()
    },
    terminou,
  }
}
