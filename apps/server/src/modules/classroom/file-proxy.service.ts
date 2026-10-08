import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Readable } from 'node:stream'
import { eq } from 'drizzle-orm'
import { lessonAttachments } from '../../db/schema'
import type { Database } from '../../db/types'
import { looksLikePdf, PDF_SIGNATURE_LENGTH } from '../../common/lib/content-safety'
import { GcsService } from './gcs.service'

/**
 * Serve PDFs de anexo pelo domínio do app (proxy) em vez de expor a URL assinada do GCS
 * (`storage.googleapis.com`) num <iframe>. Isso mantém tudo na mesma origem — evita o
 * bloqueio de DevTools de políticas corporativas em domínios do Google e não depende da
 * expiração da signed-URL no meio da sessão.
 *
 * Como <iframe> não manda header de Authorization, a URL carrega um token HMAC assinado
 * (capability URL, igual à ideia da signed-URL, mas no nosso domínio). O token só é gerado
 * para anexos de um curso a que o aluno já tem acesso (checado em ClassroomService).
 */
@Injectable()
export class FileProxyService {
  private readonly logger = new Logger(FileProxyService.name)
  private readonly secret: string

  constructor(
    @Inject('DB_CLIENT') private readonly db: Database,
    private readonly gcs: GcsService,
    config: ConfigService
  ) {
    const configured = config.get<string>('PDF_PROXY_SECRET')
    if (configured) {
      this.secret = configured
    } else {
      // Fallback: segredo aleatório por processo. OK para 1 instância (tokens são curtos e a
      // página regera ao recarregar). Em produção multi-instância, defina PDF_PROXY_SECRET.
      this.secret = randomBytes(32).toString('hex')
      this.logger.warn('PDF_PROXY_SECRET não definido — usando segredo aleatório em memória.')
    }
  }

  private sign(id: string, exp: number): string {
    return createHmac('sha256', this.secret).update(`${id}.${exp}`).digest('base64url')
  }

  private valid(id: string, exp: number, sig: string): boolean {
    if (!Number.isFinite(exp) || exp < Date.now()) return false
    const expected = Buffer.from(this.sign(id, exp))
    const got = Buffer.from(sig)
    return expected.length === got.length && timingSafeEqual(expected, got)
  }

  /** URL (mesma origem) que serve o PDF do anexo via proxy, com token assinado. */
  proxyPdfUrl(attachmentId: string, ttlSeconds = 7200): string {
    const exp = Date.now() + ttlSeconds * 1000
    return `/api/files/attachments/${attachmentId}/pdf?exp=${exp}&sig=${this.sign(attachmentId, exp)}`
  }

  /**
   * Valida o token e devolve o PDF em stream. `null` se inválido/expirado/não encontrado/não é PDF.
   *
   * O arquivo não é carregado na memória: a assinatura `%PDF` é conferida com um download de intervalo (só os primeiros
   * bytes) e o objeto inteiro segue em stream para a resposta. Apostila de centenas de MB não derruba a instância. As
   * duas leituras são fixadas na geração que o metadado informou: um arquivo trocado entre a conferência e o stream
   * (outro upload no mesmo caminho) não chega ao aluno sem ter sido conferido.
   */
  async getSignedPdf(id: string, exp: number, sig: string): Promise<{ stream: Readable; contentType: 'application/pdf'; fileName: string } | null> {
    if (!this.valid(id, exp, sig)) return null
    const rows = await this.db
      .select({ fileUrl: lessonAttachments.fileUrl, fileName: lessonAttachments.fileName })
      .from(lessonAttachments)
      .where(eq(lessonAttachments.id, id))
      .limit(1)
    const att = rows[0]
    if (!att) return null
    const versao = await this.gcs.statObject(att.fileUrl)
    if (!versao) return null
    const inicio = await this.gcs.readHead(att.fileUrl, PDF_SIGNATURE_LENGTH, { generation: versao.generation })
    // Anti-XSS: este proxy serve na MESMA origem do app, então NUNCA confiamos no content-type
    // gravado no GCS (escolhido por quem fez o upload). Recusamos o que não for um PDF de verdade
    // e forçamos application/pdf, para um `text/html` enviado como ".pdf" não virar Stored XSS.
    if (!inicio || !looksLikePdf(inicio)) return null
    const stream = this.gcs.openReadStream(att.fileUrl, { generation: versao.generation })
    if (!stream) return null
    return { stream, contentType: 'application/pdf', fileName: att.fileName }
  }
}
