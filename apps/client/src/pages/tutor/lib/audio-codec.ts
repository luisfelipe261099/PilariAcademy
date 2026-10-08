/** Conversões de áudio do tutor. Puras: testáveis sem microfone nem Web Audio. */

/** Reduz a taxa de amostragem pela média de cada janela (48 kHz → 16 kHz para a pergunta: 3x menos bytes). */
export function reduzirTaxa(entrada: Float32Array, deTaxa: number, paraTaxa: number): Float32Array {
  if (paraTaxa >= deTaxa) return entrada
  const razao = deTaxa / paraTaxa
  const tamanho = Math.floor(entrada.length / razao)
  const saida = new Float32Array(tamanho)
  for (let i = 0; i < tamanho; i++) {
    const ini = Math.floor(i * razao)
    const fim = Math.min(entrada.length, Math.floor((i + 1) * razao))
    let soma = 0
    for (let j = ini; j < fim; j++) soma += entrada[j]
    saida[i] = fim > ini ? soma / (fim - ini) : 0
  }
  return saida
}

/** WAV PCM 16 bits mono: o formato que o servidor do tutor aceita. */
export function codificarWav(amostras: Float32Array, taxa: number): Uint8Array {
  const dados = amostras.length * 2
  const buf = new ArrayBuffer(44 + dados)
  const v = new DataView(buf)
  const ascii = (pos: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(pos + i, s.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  v.setUint32(4, 36 + dados, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, taxa, true)
  v.setUint32(28, taxa * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  ascii(36, 'data')
  v.setUint32(40, dados, true)
  for (let i = 0; i < amostras.length; i++) {
    const s = Math.max(-1, Math.min(1, amostras[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Uint8Array(buf)
}

export function bytesParaBase64(bytes: Uint8Array): string {
  let s = ''
  const passo = 0x8000
  for (let i = 0; i < bytes.length; i += passo) s += String.fromCharCode(...bytes.subarray(i, i + passo))
  return btoa(s)
}

/**
 * PCM 16 bits little-endian → Float32, guardando o byte que sobrar: os pedaços do fluxo da voz podem quebrar uma
 * amostra no meio, e o byte solto vai no começo do próximo pedaço.
 */
export function pcm16ParaFloat(pedaco: Uint8Array, sobra: Uint8Array | null): { amostras: Float32Array; sobra: Uint8Array | null } {
  const bytes = sobra?.length ? concat(sobra, pedaco) : pedaco
  const pares = bytes.length - (bytes.length % 2)
  const amostras = new Float32Array(pares / 2)
  const v = new DataView(bytes.buffer, bytes.byteOffset, pares)
  for (let i = 0; i < amostras.length; i++) amostras[i] = v.getInt16(i * 2, true) / 0x8000
  return { amostras, sobra: pares < bytes.length ? bytes.slice(pares) : null }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const r = new Uint8Array(a.length + b.length)
  r.set(a, 0)
  r.set(b, a.length)
  return r
}

/** Volume (RMS) de um bloco de amostras, de 0 a ~1. */
export function rms(amostras: Float32Array): number {
  if (!amostras.length) return 0
  let soma = 0
  for (let i = 0; i < amostras.length; i++) soma += amostras[i] * amostras[i]
  return Math.sqrt(soma / amostras.length)
}
