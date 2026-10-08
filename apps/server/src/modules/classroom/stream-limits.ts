import type { Readable } from 'node:stream'

/**
 * Lê o stream inteiro para a memória contando os bytes que de fato chegam. Passou de `teto`: destrói o stream (o download
 * é abortado, nada mais chega) e devolve `null`. Falha do stream rejeita.
 */
export function lerComTeto(fonte: Readable, teto: number | undefined): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const pedacos: Buffer[] = []
    let total = 0
    let acabou = false
    fonte.on('data', (pedaco: Buffer) => {
      if (acabou) return
      total += pedaco.length
      if (teto != null && total > teto) {
        acabou = true
        fonte.destroy()
        resolve(null)
        return
      }
      pedacos.push(pedaco)
    })
    fonte.on('end', () => {
      if (acabou) return
      acabou = true
      resolve(Buffer.concat(pedacos, total))
    })
    // `on`, não `once`: um segundo erro depois do destroy, sem ouvinte, derrubaria o processo.
    fonte.on('error', (err) => {
      if (acabou) return
      acabou = true
      reject(err)
    })
  })
}

/** Os primeiros `n` bytes do stream: para assim que os tiver (destrói o stream) e nunca acumula mais que isso. */
export function primeirosBytes(fonte: Readable, n: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pedacos: Buffer[] = []
    let total = 0
    let acabou = false
    const entregar = () => {
      acabou = true
      const tudo = Buffer.concat(pedacos, total)
      resolve(tudo.subarray(0, Math.min(n, tudo.length)))
    }
    fonte.on('data', (pedaco: Buffer) => {
      if (acabou) return
      pedacos.push(pedaco.subarray(0, n - total))
      total += Math.min(pedaco.length, n - total)
      if (total >= n) {
        fonte.destroy()
        entregar()
      }
    })
    fonte.on('end', () => {
      if (!acabou) entregar()
    })
    fonte.on('error', (err) => {
      if (acabou) return
      acabou = true
      reject(err)
    })
  })
}
