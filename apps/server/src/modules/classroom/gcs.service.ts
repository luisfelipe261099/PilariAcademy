import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { getStorage } from 'firebase-admin/storage'
import type { Readable } from 'node:stream'
import { BlobStorage, blobConfigurado } from './blob-storage'
import { lerComTeto, primeirosBytes } from './stream-limits'

/** Teto das imagens servidas ou embutidas pelos proxies (capa, marca do polo, rubrica do coordenador). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
/** Teto do PDF de certificado lido do cache no GCS. Acima disso, é regerado em vez de carregado na memória. */
export const MAX_PDF_CACHE_BYTES = 20 * 1024 * 1024

/** Geração (versão) de um objeto do GCS, como o metadado a informa. */
export type ObjectGeneration = string | number | null | undefined

/** O que o metadado diz do objeto: a geração lida (para fixar as leituras seguintes), o tamanho GUARDADO e o tipo. */
export interface ObjectStat {
  generation: string | null
  size: number
  contentType: string
}

/**
 * Armazenamento dos arquivos (vídeos, PDFs, capas, marcas, certificados). Com um store do Vercel Blob conectado
 * (BLOB_READ_WRITE_TOKEN ou BLOB_STORE_ID), usa o Blob privado; senão, o bucket do GCS (GCS_BUCKET) pelo firebase-admin.
 * O nome ficou do tempo em que só havia GCS: o contrato é o mesmo nos dois.
 */
@Injectable()
export class GcsService {
  private readonly logger = new Logger(GcsService.name)
  private readonly blob: BlobStorage | null

  constructor(private readonly config: ConfigService) {
    this.blob = blobConfigurado(config) ? new BlobStorage(this.logger) : null
  }

  /**
   * URL assinada de leitura para o objeto. `null` se caminho vazio, bucket não configurado
   * ou falha ao assinar (bucket inválido/sem permissão) — nunca lança, para não derrubar
   * a página pública do curso nem a sala de aula por causa de um vídeo problemático.
   */
  async signedUrl(objectPath: string | null | undefined, ttlSeconds = 7200): Promise<string | null> {
    if (!objectPath) return null
    if (this.blob) return this.blob.signedUrl(objectPath, ttlSeconds)
    const bucket = this.config.get<string>('GCS_BUCKET')
    if (!bucket) return null
    try {
      const [url] = await getStorage()
        .bucket(bucket)
        .file(objectPath)
        .getSignedUrl({ action: 'read', expires: Date.now() + ttlSeconds * 1000 })
      return url
    } catch (err) {
      this.logger.error(`Falha ao assinar leitura de "${objectPath}" no bucket "${bucket}"`, err as Error)
      return null
    }
  }

  /** O arquivo no bucket; com `generation`, aquela versão exata (a leitura falha se ela não existir mais). */
  private arquivo(bucket: string, objectPath: string, generation?: ObjectGeneration) {
    const b = getStorage().bucket(bucket)
    return generation != null && generation !== '' ? b.file(objectPath, { generation }) : b.file(objectPath)
  }

  /** Geração, tamanho guardado e tipo do objeto. `null` se vazio/sem bucket/não existe. */
  async statObject(objectPath: string | null | undefined): Promise<ObjectStat | null> {
    if (!objectPath) return null
    if (this.blob) return this.blob.statObject(objectPath)
    const bucket = this.config.get<string>('GCS_BUCKET')
    if (!bucket) return null
    try {
      const [meta] = await this.arquivo(bucket, objectPath).getMetadata()
      return { generation: meta.generation != null ? String(meta.generation) : null, size: Number(meta.size), contentType: meta.contentType || 'application/octet-stream' }
    } catch (err) {
      this.logger.error(`Falha ao ler o metadado de "${objectPath}" do bucket "${bucket}"`, err as Error)
      return null
    }
  }

  /**
   * Baixa o objeto do GCS (bytes + content-type). `null` se vazio/sem bucket/falha.
   *
   * `maxBytes`: o objeto inteiro vai para a memória do processo, e os proxies leem caminhos que vêm de cadastro (capa,
   * marca, rubrica): um arquivo gigante no lugar de uma imagem derrubaria a instância. O limite vale para os bytes que de
   * fato CHEGAM: a biblioteca descomprime o objeto gravado com `Content-Encoding: gzip`, e o tamanho do metadado é o
   * comprimido (5 MB de gzip podem virar GBs). Passou do limite, o download é abortado, devolve `null` (para o chamador, é
   * como não existir) e avisa no log. O tamanho do metadado acima do limite é só o atalho que evita abrir o download.
   *
   * A leitura é fixada na geração que o metadado informou: se o objeto foi trocado entre as duas chamadas, ela falha em
   * vez de trazer outro arquivo.
   */
  async readObject(
    objectPath: string | null | undefined,
    opts: { maxBytes?: number } = {}
  ): Promise<{ buffer: Buffer; contentType: string } | null> {
    if (!objectPath) return null
    if (this.blob) return this.blob.readObject(objectPath, opts)
    const bucket = this.config.get<string>('GCS_BUCKET')
    if (!bucket) return null
    try {
      const [meta] = await this.arquivo(bucket, objectPath).getMetadata()
      const guardado = Number(meta.size)
      const teto = opts.maxBytes
      if (teto != null && Number.isFinite(guardado) && guardado > teto) {
        this.logger.warn(`Objeto "${objectPath}" com ${guardado} bytes guardados passa do limite de ${teto} bytes: não foi baixado.`)
        return null
      }
      const buffer = await lerComTeto(this.arquivo(bucket, objectPath, meta.generation).createReadStream(), teto)
      if (!buffer) {
        this.logger.warn(`Objeto "${objectPath}" passou do limite de ${teto} bytes no download (${guardado} bytes guardados): leitura abortada.`)
        return null
      }
      return { buffer, contentType: meta.contentType || 'application/octet-stream' }
    } catch (err) {
      this.logger.error(`Falha ao baixar "${objectPath}" do bucket "${bucket}"`, err as Error)
      return null
    }
  }

  /**
   * Só os primeiros `bytes` do objeto, para conferir a assinatura do arquivo. Pede o intervalo e, mesmo que ele não seja
   * respeitado, nunca acumula mais que isso. `generation` fixa a versão (a mesma que o stream vai ler). `null` se falhar.
   */
  async readHead(objectPath: string | null | undefined, bytes: number, opts: { generation?: ObjectGeneration } = {}): Promise<Buffer | null> {
    if (!objectPath) return null
    if (this.blob) return this.blob.readHead(objectPath, bytes, opts)
    const bucket = this.config.get<string>('GCS_BUCKET')
    if (!bucket) return null
    try {
      return await primeirosBytes(this.arquivo(bucket, objectPath, opts.generation).createReadStream({ start: 0, end: bytes - 1 }), bytes)
    } catch (err) {
      this.logger.error(`Falha ao ler o começo de "${objectPath}" do bucket "${bucket}"`, err as Error)
      return null
    }
  }

  /**
   * Stream de leitura do objeto inteiro, para repassar à resposta sem carregá-lo na memória. `generation` fixa a versão.
   * `null` se vazio ou sem bucket. Falha de leitura (objeto apagado no meio do caminho) chega como evento `error`.
   */
  openReadStream(objectPath: string | null | undefined, opts: { generation?: ObjectGeneration } = {}): Readable | null {
    if (!objectPath) return null
    if (this.blob) return this.blob.openReadStream(objectPath, opts)
    const bucket = this.config.get<string>('GCS_BUCKET')
    if (!bucket) return null
    return this.arquivo(bucket, objectPath, opts.generation).createReadStream()
  }

  /**
   * URL tocável a partir do que está salvo em `video_url`/`file_url`:
   * se já for uma URL http(s) (link direto/YouTube/etc.), usa como está;
   * caso contrário trata como objeto do GCS e assina. `null` se vazio.
   */
  async playableUrl(value: string | null | undefined, ttlSeconds = 7200): Promise<string | null> {
    if (!value) return null
    if (/^https?:\/\//i.test(value)) return value
    return this.signedUrl(value, ttlSeconds)
  }

  /** Salva um buffer no GCS. `true` se salvou; `false` se sem bucket/falha (não lança). */
  async saveObject(objectPath: string, buffer: Buffer, contentType: string): Promise<boolean> {
    if (this.blob) return this.blob.saveObject(objectPath, buffer, contentType)
    const bucket = this.config.get<string>('GCS_BUCKET')
    if (!bucket) return false
    try {
      await getStorage().bucket(bucket).file(objectPath).save(buffer, { contentType, resumable: false })
      return true
    } catch (err) {
      this.logger.error(`Falha ao salvar "${objectPath}" no bucket "${bucket}"`, err as Error)
      return false
    }
  }

  /** Apaga um objeto do GCS. `true` se apagou (ou já não existia); `false` se sem bucket/falha. */
  async deleteObject(objectPath: string): Promise<boolean> {
    if (this.blob) return this.blob.deleteObject(objectPath)
    const bucket = this.config.get<string>('GCS_BUCKET')
    if (!bucket) return false
    try {
      await getStorage().bucket(bucket).file(objectPath).delete({ ignoreNotFound: true })
      return true
    } catch (err) {
      this.logger.error(`Falha ao apagar "${objectPath}" no bucket "${bucket}"`, err as Error)
      return false
    }
  }

  /** URL assinada de upload (PUT). `null` se caminho vazio, bucket não configurado ou falha. */
  async signedUploadUrl(objectPath: string, contentType: string, ttlSeconds = 900): Promise<string | null> {
    if (!objectPath) return null
    if (this.blob) return this.blob.signedUploadUrl(objectPath, contentType, ttlSeconds)
    const bucket = this.config.get<string>('GCS_BUCKET')
    if (!bucket) return null
    try {
      const [url] = await getStorage()
        .bucket(bucket)
        .file(objectPath)
        .getSignedUrl({ action: 'write', contentType, expires: Date.now() + ttlSeconds * 1000 })
      return url
    } catch (err) {
      this.logger.error(`Falha ao assinar upload de "${objectPath}" no bucket "${bucket}"`, err as Error)
      return null
    }
  }
}
