import { Logger } from '@nestjs/common'
import { BlobStorage, blobConfigurado } from './blob-storage'

jest.mock('@vercel/blob', () => ({
  put: jest.fn(),
  get: jest.fn(),
  head: jest.fn(),
  del: jest.fn(),
  issueSignedToken: jest.fn(),
  presignUrl: jest.fn(),
}))
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sdk = require('@vercel/blob') as Record<string, jest.Mock>

const stream = (texto: string): ReadableStream<Uint8Array> =>
  new ReadableStream({ start: (c) => { c.enqueue(new TextEncoder().encode(texto)); c.close() } })
const lido = (blob: Partial<{ etag: string; size: number; contentType: string }>, texto = '%PDF-1.4 conteudo') => ({
  statusCode: 200,
  stream: stream(texto),
  blob: { etag: 'e1', size: texto.length, contentType: 'application/pdf', ...blob },
})
const ateOFim = (r: NodeJS.ReadableStream): Promise<string> =>
  new Promise((ok, erro) => {
    let t = ''
    r.on('data', (d: Buffer) => (t += d.toString()))
    r.on('end', () => ok(t))
    r.on('error', erro)
  })

describe('BlobStorage', () => {
  const logger = { error: jest.fn(), warn: jest.fn() } as unknown as Logger
  const blob = new BlobStorage(logger)
  beforeEach(() => jest.clearAllMocks())

  it('só liga com token de escrita ou store id', () => {
    expect(blobConfigurado({ get: () => undefined })).toBe(false)
    expect(blobConfigurado({ get: (k) => (k === 'BLOB_READ_WRITE_TOKEN' ? 'x' : undefined) })).toBe(true)
    expect(blobConfigurado({ get: (k) => (k === 'BLOB_STORE_ID' ? 'x' : undefined) })).toBe(true)
  })

  it('upload assinado é PUT restrito ao caminho e ao tipo, sem sufixo aleatório', async () => {
    sdk.issueSignedToken.mockResolvedValue({ delegationToken: 'd', clientSigningToken: 'c', validUntil: 1 })
    sdk.presignUrl.mockResolvedValue({ presignedUrl: 'https://vercel.com/api/blob/?x' })
    await expect(blob.signedUploadUrl('cursos/c1/capa.png', 'image/png', 900)).resolves.toBe('https://vercel.com/api/blob/?x')
    expect(sdk.issueSignedToken).toHaveBeenCalledWith(expect.objectContaining({ pathname: 'cursos/c1/capa.png', operations: ['put'], allowedContentTypes: ['image/png'] }))
    expect(sdk.presignUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ operation: 'put', access: 'private', allowedContentTypes: ['image/png'], allowOverwrite: true, addRandomSuffix: false })
    )
  })

  it('falha ao assinar vira null, sem lançar', async () => {
    sdk.issueSignedToken.mockRejectedValue(new Error('rede'))
    await expect(blob.signedUrl('cursos/c1/v.mp4', 7200)).resolves.toBeNull()
    expect(logger.error).toHaveBeenCalled()
  })

  it('metadado: ETag vira a geração', async () => {
    sdk.head.mockResolvedValue({ etag: '"abc"', size: 10, contentType: 'application/pdf' })
    await expect(blob.statObject('a.pdf')).resolves.toEqual({ generation: '"abc"', size: 10, contentType: 'application/pdf' })
  })

  it('leitura acima do teto pelo tamanho guardado não baixa', async () => {
    sdk.get.mockResolvedValue(lido({ size: 999 }))
    await expect(blob.readObject('a.png', { maxBytes: 10 })).resolves.toBeNull()
  })

  it('leitura dentro do teto devolve bytes e tipo', async () => {
    sdk.get.mockResolvedValue(lido({}, 'abc'))
    const r = await blob.readObject('a.txt', { maxBytes: 10 })
    expect(r?.buffer.toString()).toBe('abc')
    expect(r?.contentType).toBe('application/pdf')
  })

  it('primeiros bytes pedem intervalo e recusam arquivo trocado (ETag diferente)', async () => {
    sdk.get.mockResolvedValue(lido({ etag: 'e2' }))
    await expect(blob.readHead('a.pdf', 5, { generation: 'e1' })).resolves.toBeNull()
    expect(sdk.get).toHaveBeenCalledWith('a.pdf', expect.objectContaining({ useCache: false, headers: { Range: 'bytes=0-4' } }))
    sdk.get.mockResolvedValue(lido({ etag: 'e1' }))
    await expect(blob.readHead('a.pdf', 5, { generation: 'e1' }).then((b) => b?.toString())).resolves.toBe('%PDF-')
  })

  it('stream: entrega o conteúdo da mesma versão e erra se o arquivo mudou ou sumiu', async () => {
    sdk.get.mockResolvedValue(lido({ etag: 'e1' }, 'pdf inteiro'))
    await expect(ateOFim(blob.openReadStream('a.pdf', { generation: 'e1' }))).resolves.toBe('pdf inteiro')
    sdk.get.mockResolvedValue(lido({ etag: 'e9' }))
    await expect(ateOFim(blob.openReadStream('a.pdf', { generation: 'e1' }))).rejects.toThrow('ETag diferente')
    sdk.get.mockResolvedValue(null)
    await expect(ateOFim(blob.openReadStream('a.pdf', {}))).rejects.toThrow('não encontrado')
  })

  it('gravar é privado e sobrescreve no mesmo caminho', async () => {
    sdk.put.mockResolvedValue({})
    await expect(blob.saveObject('cert/x.pdf', Buffer.from('x'), 'application/pdf')).resolves.toBe(true)
    expect(sdk.put).toHaveBeenCalledWith('cert/x.pdf', expect.any(Buffer), { access: 'private', contentType: 'application/pdf', addRandomSuffix: false, allowOverwrite: true })
    sdk.put.mockRejectedValue(new Error('cota'))
    await expect(blob.saveObject('cert/x.pdf', Buffer.from('x'), 'application/pdf')).resolves.toBe(false)
  })
})
