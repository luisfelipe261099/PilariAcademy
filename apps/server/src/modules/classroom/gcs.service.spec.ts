/// <reference types="jest" />
import { Readable } from 'node:stream'
import type { Logger } from '@nestjs/common'

/** O arquivo do bucket falso: cada teste programa o que precisa (metadado, download, stream). */
const mockArquivo = {
  getSignedUrl: jest.fn(async () => ['http://signed']),
  getMetadata: jest.fn(),
  download: jest.fn(),
  createReadStream: jest.fn(),
}
/** Os argumentos de cada `bucket.file(...)`: prova em que geração do objeto cada leitura foi feita. */
const mockArquivosAbertos: unknown[][] = []
jest.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({
      file: (...args: unknown[]) => {
        mockArquivosAbertos.push(args)
        return mockArquivo
      },
    }),
  }),
}))

import { GcsService, MAX_IMAGE_BYTES, MAX_PDF_CACHE_BYTES } from './gcs.service'

function make(bucket: string | undefined) {
  const config = { get: (k: string) => (k === 'GCS_BUCKET' ? bucket : undefined) }
  return new GcsService(config as never)
}

describe('GcsService', () => {
  it('caminho vazio → null', async () => {
    expect(await make('b').signedUrl(null)).toBeNull()
    expect(await make('b').signedUrl('')).toBeNull()
  })
  it('sem GCS_BUCKET → null', async () => {
    expect(await make(undefined).signedUrl('path/v.mp4')).toBeNull()
  })
  it('com bucket e caminho → url assinada', async () => {
    expect(await make('b').signedUrl('path/v.mp4')).toBe('http://signed')
  })
  it('signedUploadUrl: com bucket → url assinada de PUT', async () => {
    expect(await make('b').signedUploadUrl('path/v.mp4', 'video/mp4')).toBe('http://signed')
  })
  it('signedUploadUrl: sem bucket → null', async () => {
    expect(await make(undefined).signedUploadUrl('path/v.mp4', 'video/mp4')).toBeNull()
  })
  it('saveObject sem GCS_BUCKET → false', async () => {
    const svc = make(undefined)
    const ok = await svc.saveObject('certificates/a/b.pdf', Buffer.from('x'), 'application/pdf')
    expect(ok).toBe(false)
  })
})

describe('GcsService: leitura com limite de tamanho', () => {
  beforeEach(() => {
    mockArquivo.getMetadata.mockReset()
    mockArquivo.download.mockReset()
    mockArquivo.createReadStream.mockReset()
    mockArquivosAbertos.length = 0
  })
  const avisos = (svc: GcsService) => jest.spyOn((svc as unknown as { logger: Logger }).logger, 'warn').mockImplementation(() => undefined)
  const erros = (svc: GcsService) => jest.spyOn((svc as unknown as { logger: Logger }).logger, 'error').mockImplementation(() => undefined)
  /** Stream que entrega `total` bytes em pedaços de 64 KB, sob demanda (como a resposta do GCS). */
  const fluxoDe = (total: number) => {
    let entregue = 0
    return new Readable({
      read() {
        if (entregue >= total) return void this.push(null)
        const n = Math.min(64 * 1024, total - entregue)
        entregue += n
        this.push(Buffer.alloc(n, 0x61))
      },
    })
  }
  const metadado = (over: Record<string, unknown> = {}) => [{ size: '1000', contentType: 'image/png', generation: '1700000000000001', ...over }]

  it('os limites: 5 MB para imagem e 20 MB para o PDF em cache', () => {
    expect(MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024)
    expect(MAX_PDF_CACHE_BYTES).toBe(20 * 1024 * 1024)
  })

  it('o tamanho guardado já passa do limite: null sem nem abrir o download (atalho) e aviso com caminho e tamanho', async () => {
    const svc = make('b')
    const warn = avisos(svc)
    mockArquivo.getMetadata.mockResolvedValue(metadado({ size: '6000000' }))
    expect(await svc.readObject('cursos/c1/cover/enorme.png', { maxBytes: MAX_IMAGE_BYTES })).toBeNull()
    expect(mockArquivo.createReadStream).not.toHaveBeenCalled()
    expect(mockArquivo.download).not.toHaveBeenCalled()
    expect(warn.mock.calls[0][0]).toEqual(expect.stringContaining('cursos/c1/cover/enorme.png'))
    expect(warn.mock.calls[0][0]).toEqual(expect.stringContaining('6000000'))
  })

  it('gzip pequeno que infla no download (o guardado diz 1000 bytes): a conta é a dos bytes recebidos, e o download é abortado', async () => {
    const svc = make('b')
    const warn = avisos(svc)
    mockArquivo.getMetadata.mockResolvedValue(metadado({ size: '1000' }))
    const fonte = fluxoDe(50 * 1024 * 1024) // a "bomba" já descomprimida pela biblioteca
    mockArquivo.createReadStream.mockReturnValue(fonte)
    expect(await svc.readObject('cursos/c1/cover/bomba.png', { maxBytes: MAX_IMAGE_BYTES })).toBeNull()
    expect(fonte.destroyed).toBe(true)
    expect(mockArquivo.download).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toEqual(expect.stringContaining('cursos/c1/cover/bomba.png'))
  })

  it('dentro do limite (exatamente nele inclusive): devolve os bytes e o tipo do metadado', async () => {
    const svc = make('b')
    mockArquivo.getMetadata.mockResolvedValue(metadado({ size: '1000' }))
    mockArquivo.createReadStream.mockReturnValue(fluxoDe(MAX_IMAGE_BYTES))
    const r = await svc.readObject('cursos/c1/cover/capa.png', { maxBytes: MAX_IMAGE_BYTES })
    expect(r?.buffer.length).toBe(MAX_IMAGE_BYTES)
    expect(r?.contentType).toBe('image/png')
  })

  it('lê a MESMA geração do metadado: o objeto trocado entre as duas chamadas não entra sem conferência', async () => {
    const svc = make('b')
    mockArquivo.getMetadata.mockResolvedValue(metadado({ generation: '1700000000000042' }))
    mockArquivo.createReadStream.mockReturnValue(fluxoDe(10))
    await svc.readObject('cursos/c1/cover/capa.png', { maxBytes: MAX_IMAGE_BYTES })
    expect(mockArquivosAbertos).toEqual([['cursos/c1/cover/capa.png'], ['cursos/c1/cover/capa.png', { generation: '1700000000000042' }]])
  })

  it('sem limite pedido, lê inteiro como antes', async () => {
    const svc = make('b')
    mockArquivo.getMetadata.mockResolvedValue(metadado({ size: '999999999', contentType: 'application/pdf' }))
    mockArquivo.createReadStream.mockReturnValue(fluxoDe(300 * 1024))
    expect((await svc.readObject('x.pdf'))?.buffer.length).toBe(300 * 1024)
  })

  it('falha no meio da leitura: null e erro no log', async () => {
    const svc = make('b')
    const erro = erros(svc)
    mockArquivo.getMetadata.mockResolvedValue(metadado())
    mockArquivo.createReadStream.mockReturnValue(new Readable({ read() { this.destroy(new Error('No such object')) } }))
    expect(await svc.readObject('sumiu.png', { maxBytes: MAX_IMAGE_BYTES })).toBeNull()
    expect(erro).toHaveBeenCalled()
  })

  it('statObject: geração, tamanho guardado e tipo; null sem bucket, sem caminho ou se o objeto não existe', async () => {
    const svc = make('b')
    mockArquivo.getMetadata.mockResolvedValue(metadado({ size: '2048', contentType: 'application/pdf' }))
    expect(await svc.statObject('cursos/c1/attachment/a.pdf')).toEqual({ generation: '1700000000000001', size: 2048, contentType: 'application/pdf' })
    expect(await make(undefined).statObject('a.pdf')).toBeNull()
    expect(await svc.statObject('')).toBeNull()
    erros(svc)
    mockArquivo.getMetadata.mockRejectedValue(new Error('No such object'))
    expect(await svc.statObject('sumiu.pdf')).toBeNull()
  })

  it('readHead: intervalo pedido na geração dada, e nunca mais que os bytes pedidos (mesmo se o intervalo for ignorado)', async () => {
    const svc = make('b')
    const fonte = fluxoDe(10 * 1024 * 1024)
    mockArquivo.createReadStream.mockReturnValue(fonte)
    const inicio = await svc.readHead('cursos/c1/attachment/a.pdf', 5, { generation: '1700000000000007' })
    expect(inicio?.length).toBe(5)
    expect(mockArquivo.createReadStream).toHaveBeenCalledWith({ start: 0, end: 4 })
    expect(mockArquivosAbertos).toEqual([['cursos/c1/attachment/a.pdf', { generation: '1700000000000007' }]])
    expect(fonte.destroyed).toBe(true)
    expect(mockArquivo.download).not.toHaveBeenCalled()
  })

  it('readHead: sem bucket, caminho vazio ou falha → null', async () => {
    expect(await make(undefined).readHead('a.pdf', 5)).toBeNull()
    expect(await make('b').readHead('', 5)).toBeNull()
    const svc = make('b')
    erros(svc)
    mockArquivo.createReadStream.mockReturnValue(new Readable({ read() { this.destroy(new Error('No such object')) } }))
    expect(await svc.readHead('sumiu.pdf', 5)).toBeNull()
  })

  it('openReadStream: o objeto inteiro em stream, na geração dada, sem baixar nada antes', () => {
    const stream = Readable.from([Buffer.from('%PDF-1.4 ...')])
    mockArquivo.createReadStream.mockReturnValue(stream)
    expect(make('b').openReadStream('cursos/c1/attachment/a.pdf', { generation: '1700000000000007' })).toBe(stream)
    expect(mockArquivosAbertos).toEqual([['cursos/c1/attachment/a.pdf', { generation: '1700000000000007' }]])
    expect(mockArquivo.download).not.toHaveBeenCalled()
    expect(make(undefined).openReadStream('a.pdf')).toBeNull()
    expect(make('b').openReadStream('')).toBeNull()
  })
})
