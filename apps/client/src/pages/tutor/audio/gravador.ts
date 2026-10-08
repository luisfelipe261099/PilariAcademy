import { codificarWav, reduzirTaxa, rms } from '../lib/audio-codec'
import { criarDetector } from '../lib/silence-detector'

/** A pergunta vai a 16 kHz: suficiente para fala e 3x menor que os 48 kHz do microfone. */
const TAXA_PERGUNTA = 16000
/** Parada manual com menos que isso de áudio é toque sem querer: descarta. */
const MIN_SEGUNDOS = 0.5

export interface PerguntaGravada {
  wav: Uint8Array
  segundos: number
}

export interface Gravacao {
  /** Volume atual de 0 a 1, suavizado, para animar a esfera. */
  nivel(): number
  /** O aluno tocou de novo: encerra e envia o que foi falado. */
  parar(): void
  cancelar(): void
  /** `null` quando o aluno não falou nada ou cancelou. */
  resultado: Promise<PerguntaGravada | null>
}

/**
 * Grava a pergunta do microfone e encerra sozinho depois de ~1,3 s de silêncio. Usa ScriptProcessor (não
 * AudioWorklet) porque o módulo do worklet precisaria de blob: no script-src da CSP.
 */
export async function iniciarGravacao(): Promise<Gravacao> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  })
  const ctx = new AudioContext()
  const fonte = ctx.createMediaStreamSource(stream)
  const processador = ctx.createScriptProcessor(4096, 1, 1)
  const blocos: Float32Array[] = []
  const detector = criarDetector()
  let nivel = 0
  let encerrada = false
  let resolver!: (r: PerguntaGravada | null) => void
  const resultado = new Promise<PerguntaGravada | null>((ok) => (resolver = ok))

  function encerrar(enviar: boolean) {
    if (encerrada) return
    encerrada = true
    processador.onaudioprocess = null
    fonte.disconnect()
    processador.disconnect()
    stream.getTracks().forEach((t) => t.stop())
    const taxa = ctx.sampleRate
    void ctx.close()
    const total = blocos.reduce((n, b) => n + b.length, 0)
    if (!enviar || total / taxa < MIN_SEGUNDOS) return resolver(null)
    const tudo = new Float32Array(total)
    let pos = 0
    for (const b of blocos) {
      tudo.set(b, pos)
      pos += b.length
    }
    const reduzido = reduzirTaxa(tudo, taxa, TAXA_PERGUNTA)
    resolver({ wav: codificarWav(reduzido, TAXA_PERGUNTA), segundos: reduzido.length / TAXA_PERGUNTA })
  }

  processador.onaudioprocess = (e) => {
    const dados = new Float32Array(e.inputBuffer.getChannelData(0))
    blocos.push(dados)
    const volume = rms(dados)
    nivel = Math.max(Math.min(1, volume * 7), nivel * 0.85)
    const decisao = detector.processar(volume, performance.now())
    if (decisao === 'fim' || decisao === 'limite') encerrar(true)
    else if (decisao === 'sem-fala') encerrar(false)
  }
  fonte.connect(processador)
  // Sem ligar ao destino, alguns navegadores não chamam onaudioprocess. A saída é silêncio.
  processador.connect(ctx.destination)

  return {
    nivel: () => nivel,
    parar: () => encerrar(true),
    cancelar: () => encerrar(false),
    resultado,
  }
}
