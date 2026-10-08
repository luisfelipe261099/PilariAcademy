/// <reference types="jest" />
import { Readable } from 'node:stream'
import { createDrizzleMock, withQueryResults, type DrizzleMock } from '../../__test-utils__/drizzle-mock'
import { FileProxyService } from './file-proxy.service'

function make() {
  const db: DrizzleMock = createDrizzleMock()
  const gcs = {
    // A versão do objeto é lida uma vez, e a conferência e o stream leem essa mesma geração.
    statObject: jest.fn(async () => ({ generation: '1700000000000007', size: 4096, contentType: 'text/html' }) as { generation: string | null; size: number; contentType: string } | null),
    // Só o começo do arquivo é baixado (para conferir a assinatura); o resto segue em stream.
    readHead: jest.fn(async (_p: string, bytes: number) => Buffer.from('%PDF-1.4').subarray(0, bytes) as Buffer | null),
    openReadStream: jest.fn((): Readable | null => Readable.from([Buffer.from('%PDF-1.4 conteúdo')])),
    readObject: jest.fn(),
  }
  const config = { get: jest.fn(() => undefined) } // sem PDF_PROXY_SECRET → segredo aleatório
  return { db, gcs, service: new FileProxyService(db as never, gcs as never, config as never) }
}

function parseToken(url: string): { id: string; exp: number; sig: string } {
  const m = url.match(/attachments\/([^/]+)\/pdf\?exp=(\d+)&sig=(.+)$/)
  if (!m) throw new Error(`URL inesperada: ${url}`)
  return { id: m[1], exp: Number(m[2]), sig: m[3] }
}

describe('FileProxyService', () => {
  it('token válido → devolve o PDF em stream, sem baixar o arquivo inteiro', async () => {
    const { db, gcs, service } = make()
    withQueryResults(db, [{ fileUrl: 'path/a.pdf', fileName: 'a.pdf' }])
    const { id, exp, sig } = parseToken(service.proxyPdfUrl('att1'))
    const out = await service.getSignedPdf(id, exp, sig)
    expect(out?.fileName).toBe('a.pdf')
    expect(out?.contentType).toBe('application/pdf')
    expect(out?.stream).toBeInstanceOf(Readable)
    // a assinatura é conferida com os 5 primeiros bytes ("%PDF-"), e o objeto inteiro nunca vai para a memória
    expect(gcs.readHead).toHaveBeenCalledWith('path/a.pdf', 5, { generation: '1700000000000007' })
    expect(gcs.openReadStream).toHaveBeenCalledWith('path/a.pdf', { generation: '1700000000000007' })
    expect(gcs.readObject).not.toHaveBeenCalled()
  })

  it('a conferência do %PDF e o stream leem a MESMA geração do objeto (o arquivo trocado no meio não passa sem conferência)', async () => {
    const { db, gcs, service } = make()
    withQueryResults(db, [{ fileUrl: 'path/a.pdf', fileName: 'a.pdf' }])
    gcs.statObject.mockResolvedValueOnce({ generation: '1700000000000099', size: 10, contentType: 'application/pdf' })
    const { id, exp, sig } = parseToken(service.proxyPdfUrl('att1'))
    await service.getSignedPdf(id, exp, sig)
    expect(gcs.statObject).toHaveBeenCalledWith('path/a.pdf')
    expect(gcs.readHead).toHaveBeenCalledWith('path/a.pdf', 5, { generation: '1700000000000099' })
    expect(gcs.openReadStream).toHaveBeenCalledWith('path/a.pdf', { generation: '1700000000000099' })
  })

  it('objeto inexistente (sem metadado) → null, sem conferir nem abrir stream', async () => {
    const { db, gcs, service } = make()
    withQueryResults(db, [{ fileUrl: 'path/sumiu.pdf', fileName: 'a.pdf' }])
    gcs.statObject.mockResolvedValueOnce(null)
    const { id, exp, sig } = parseToken(service.proxyPdfUrl('att1'))
    expect(await service.getSignedPdf(id, exp, sig)).toBeNull()
    expect(gcs.readHead).not.toHaveBeenCalled()
    expect(gcs.openReadStream).not.toHaveBeenCalled()
  })

  it('assinatura adulterada → null (nem consulta o banco nem o bucket)', async () => {
    const { db, gcs, service } = make()
    const { id, exp } = parseToken(service.proxyPdfUrl('att1'))
    expect(await service.getSignedPdf(id, exp, 'forjado')).toBeNull()
    expect(db.select).not.toHaveBeenCalled()
    expect(gcs.readHead).not.toHaveBeenCalled()
  })

  it('token expirado → null', async () => {
    const { service } = make()
    expect(await service.getSignedPdf('att1', Date.now() - 1000, 'qualquer')).toBeNull()
  })

  it('anexo inexistente → null', async () => {
    const { db, gcs, service } = make()
    withQueryResults(db, [])
    const { id, exp, sig } = parseToken(service.proxyPdfUrl('att1'))
    expect(await service.getSignedPdf(id, exp, sig)).toBeNull()
    expect(gcs.readHead).not.toHaveBeenCalled()
  })

  it('objeto não é PDF de verdade (HTML disfarçado) → null e o stream nem é aberto (anti-XSS)', async () => {
    const { db, gcs, service } = make()
    withQueryResults(db, [{ fileUrl: 'path/x.pdf', fileName: 'material.pdf' }])
    gcs.readHead.mockResolvedValueOnce(Buffer.from('<scri'))
    const { id, exp, sig } = parseToken(service.proxyPdfUrl('att1'))
    expect(await service.getSignedPdf(id, exp, sig)).toBeNull()
    expect(gcs.openReadStream).not.toHaveBeenCalled()
  })

  it('objeto sumiu do bucket (começo não lido) ou sem bucket para o stream → null', async () => {
    const a = make()
    withQueryResults(a.db, [{ fileUrl: 'path/x.pdf', fileName: 'material.pdf' }])
    a.gcs.readHead.mockResolvedValueOnce(null)
    const t1 = parseToken(a.service.proxyPdfUrl('att1'))
    expect(await a.service.getSignedPdf(t1.id, t1.exp, t1.sig)).toBeNull()

    const b = make()
    withQueryResults(b.db, [{ fileUrl: 'path/x.pdf', fileName: 'material.pdf' }])
    b.gcs.openReadStream.mockReturnValueOnce(null)
    const t2 = parseToken(b.service.proxyPdfUrl('att1'))
    expect(await b.service.getSignedPdf(t2.id, t2.exp, t2.sig)).toBeNull()
  })

  it('o content-type do GCS nem é consultado: sempre application/pdf (anti-XSS)', async () => {
    const { db, service } = make()
    withQueryResults(db, [{ fileUrl: 'path/x.pdf', fileName: 'material.pdf' }])
    const { id, exp, sig } = parseToken(service.proxyPdfUrl('att1'))
    expect((await service.getSignedPdf(id, exp, sig))?.contentType).toBe('application/pdf')
  })
})
