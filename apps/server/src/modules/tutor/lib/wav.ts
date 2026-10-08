/** WAV PCM 16 bits mono: o que o navegador grava para a pergunta e o que o tutor devolve para tocar. */

export interface WavInfo {
  sampleRate: number
  channels: number
  bitsPerSample: number
  dataBytes: number
  seconds: number
}

/** Cabeçalho de 44 bytes + PCM. O Gemini TTS devolve PCM cru (sem cabeçalho) a 24 kHz. */
export function pcmToWav(pcm: Buffer, sampleRate = 24000): Buffer {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0, 'ascii')
  h.writeUInt32LE(36 + pcm.length, 4)
  h.write('WAVE', 8, 'ascii')
  h.write('fmt ', 12, 'ascii')
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(1, 22)
  h.writeUInt32LE(sampleRate, 24)
  h.writeUInt32LE(sampleRate * 2, 28)
  h.writeUInt16LE(2, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36, 'ascii')
  h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}

/**
 * Lê o cabeçalho de um WAV PCM e calcula a duração. `null` se não for WAV PCM (RIFF/WAVE com chunks fmt e data).
 * Percorre os chunks em vez de supor 44 bytes: navegadores e ferramentas às vezes incluem chunks extras (LIST).
 */
export function wavInfo(buf: Buffer): WavInfo | null {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null
  let pos = 12
  let fmt: { channels: number; sampleRate: number; bitsPerSample: number; format: number } | null = null
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    const body = pos + 8
    if (id === 'fmt ' && body + 16 <= buf.length) {
      fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), sampleRate: buf.readUInt32LE(body + 4), bitsPerSample: buf.readUInt16LE(body + 14) }
    } else if (id === 'data') {
      if (!fmt || fmt.format !== 1 || !fmt.sampleRate || !fmt.channels || !fmt.bitsPerSample) return null
      const dataBytes = Math.min(size, buf.length - body)
      const bytesPorSegundo = fmt.sampleRate * fmt.channels * (fmt.bitsPerSample / 8)
      return { sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: fmt.bitsPerSample, dataBytes, seconds: dataBytes / bytesPorSegundo }
    }
    pos = body + size + (size % 2)
  }
  return null
}
