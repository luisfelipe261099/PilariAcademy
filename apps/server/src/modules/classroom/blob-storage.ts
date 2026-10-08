import type { Logger } from '@nestjs/common'
import { del, get, head, issueSignedToken, presignUrl, put } from '@vercel/blob'
import { PassThrough, Readable } from 'node:stream'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import type { ObjectGeneration, ObjectStat } from './gcs.service'
import { lerComTeto, primeirosBytes } from './stream-limits'

/** Store do Vercel Blob conectado ao projeto: token de leitura e escrita ou credencial OIDC do store. */
export function blobConfigurado(env: { get(chave: string): string | undefined }): boolean {
  return !!(env.get('BLOB_READ_WRITE_TOKEN') || env.get('BLOB_STORE_ID'))
}

const comoNode = (s: ReadableStream<Uint8Array>): Readable => Readable.fromWeb(s as unknown as WebReadableStream<Uint8Array>)
const versao = (g: ObjectGeneration): string | null => (g != null && g !== '' ? String(g) : null)

/**
 * Armazenamento no Vercel Blob (store PRIVADO), com o mesmo contrato do GCS no GcsService: caminhos `cursos/<id>/...`
 * viram pathnames do store, a "geração" é o ETag do blob e as URLs assinadas são presigned URLs de curta duração.
 * Nenhum método lança: falha vira `null`/`false` com log, como no GCS.
 */
export class BlobStorage {
  constructor(private readonly logger: Logger) {}

  private async urlAssinada(objectPath: string, operacao: 'get' | 'put', ttlSeconds: number, contentType?: string): Promise<string> {
    const validUntil = Date.now() + ttlSeconds * 1000
    const tipos = contentType ? [contentType] : undefined
    const token = await issueSignedToken({ pathname: objectPath, operations: [operacao], validUntil, allowedContentTypes: tipos })
    const { presignedUrl } =
      operacao === 'get'
        ? await presignUrl(token, { operation: 'get', pathname: objectPath, access: 'private', validUntil })
        : await presignUrl(token, {
            operation: 'put', pathname: objectPath, access: 'private', validUntil,
            allowedContentTypes: tipos, allowOverwrite: true, addRandomSuffix: false,
          })
    return presignedUrl
  }

  async signedUrl(objectPath: string, ttlSeconds: number): Promise<string | null> {
    try {
      return await this.urlAssinada(objectPath, 'get', ttlSeconds)
    } catch (err) {
      this.logger.error(`Falha ao assinar leitura de "${objectPath}" no Blob`, err as Error)
      return null
    }
  }

  async signedUploadUrl(objectPath: string, contentType: string, ttlSeconds: number): Promise<string | null> {
    try {
      return await this.urlAssinada(objectPath, 'put', ttlSeconds, contentType)
    } catch (err) {
      this.logger.error(`Falha ao assinar upload de "${objectPath}" no Blob`, err as Error)
      return null
    }
  }

  async statObject(objectPath: string): Promise<ObjectStat | null> {
    try {
      const h = await head(objectPath)
      return { generation: h.etag || null, size: h.size, contentType: h.contentType || 'application/octet-stream' }
    } catch (err) {
      this.logger.error(`Falha ao ler o metadado de "${objectPath}" do Blob`, err as Error)
      return null
    }
  }

  /** Bytes + tipo. O teto vale para os bytes que chegam; o tamanho guardado acima do teto evita abrir o download. */
  async readObject(objectPath: string, opts: { maxBytes?: number }): Promise<{ buffer: Buffer; contentType: string } | null> {
    try {
      const r = await get(objectPath, { access: 'private' })
      if (!r || r.statusCode !== 200 || !r.stream) return null
      const teto = opts.maxBytes
      if (teto != null && r.blob.size > teto) {
        await r.stream.cancel()
        this.logger.warn(`Objeto "${objectPath}" com ${r.blob.size} bytes guardados passa do limite de ${teto} bytes: não foi baixado.`)
        return null
      }
      const buffer = await lerComTeto(comoNode(r.stream), teto)
      if (!buffer) {
        this.logger.warn(`Objeto "${objectPath}" passou do limite de ${teto} bytes no download: leitura abortada.`)
        return null
      }
      return { buffer, contentType: r.blob.contentType || 'application/octet-stream' }
    } catch (err) {
      this.logger.error(`Falha ao baixar "${objectPath}" do Blob`, err as Error)
      return null
    }
  }

  /**
   * Os primeiros `bytes`, pedidos por intervalo. Com `generation`, lê direto da origem (sem cache de CDN) e recusa se o
   * ETag mudou: o arquivo foi trocado depois do metadado, e o proxy não pode conferir um e servir outro.
   */
  async readHead(objectPath: string, bytes: number, opts: { generation?: ObjectGeneration }): Promise<Buffer | null> {
    const esperado = versao(opts.generation)
    try {
      const r = await get(objectPath, { access: 'private', useCache: esperado == null, headers: { Range: `bytes=0-${bytes - 1}` } })
      if (!r || !r.stream) return null
      if (esperado != null && r.blob.etag !== esperado) {
        await r.stream.cancel()
        this.logger.warn(`Objeto "${objectPath}" mudou entre o metadado e a leitura (ETag diferente): leitura recusada.`)
        return null
      }
      return await primeirosBytes(comoNode(r.stream), bytes)
    } catch (err) {
      this.logger.error(`Falha ao ler o começo de "${objectPath}" do Blob`, err as Error)
      return null
    }
  }

  /**
   * Stream do objeto inteiro, devolvido na hora (o download começa em seguida). Arquivo inexistente, trocado (ETag
   * diferente de `generation`) ou falha de rede chegam como evento `error`, como no GCS.
   */
  openReadStream(objectPath: string, opts: { generation?: ObjectGeneration }): Readable {
    const saida = new PassThrough()
    const esperado = versao(opts.generation)
    void get(objectPath, { access: 'private', useCache: esperado == null })
      .then(async (r) => {
        if (!r || !r.stream) throw new Error(`Objeto "${objectPath}" não encontrado no Blob`)
        if (esperado != null && r.blob.etag !== esperado) {
          await r.stream.cancel()
          throw new Error(`Objeto "${objectPath}" mudou depois do metadado (ETag diferente)`)
        }
        const origem = comoNode(r.stream)
        origem.on('error', (err) => saida.destroy(err))
        origem.pipe(saida)
      })
      .catch((err: Error) => saida.destroy(err))
    return saida
  }

  async saveObject(objectPath: string, buffer: Buffer, contentType: string): Promise<boolean> {
    try {
      await put(objectPath, buffer, { access: 'private', contentType, addRandomSuffix: false, allowOverwrite: true })
      return true
    } catch (err) {
      this.logger.error(`Falha ao salvar "${objectPath}" no Blob`, err as Error)
      return false
    }
  }

  async deleteObject(objectPath: string): Promise<boolean> {
    try {
      await del(objectPath)
      return true
    } catch (err) {
      this.logger.error(`Falha ao apagar "${objectPath}" no Blob`, err as Error)
      return false
    }
  }
}
