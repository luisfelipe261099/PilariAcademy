import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findTemplateNetworkViolation } from '../../common/lib/content-safety'

export interface CertData {
  studentName: string
  courseTitle: string
  hours: number
  issuedAt: Date
  code: string
  qrDataUri: string
  verifyUrl: string
  cpf?: string
  /** 2a assinatura (coordenador do curso). Vazio → o template não desenha o bloco. */
  coordinatorName?: string
  coordinatorRole?: string
  /**
   * Rubrica do coordenador JÁ EMBUTIDA como data URI. Tem que ser data URI: o sandbox de
   * rede do renderizador recusa qualquer referência externa no template.
   */
  coordinatorSignatureDataUri?: string
}

const TEMPLATE_HTML_PATH = join(__dirname, 'assets', 'certificate.html')
const TEMPLATE_BG_PATH = join(__dirname, 'assets', 'certificate-template.png')
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 2000
const TIMEOUT_MS = 90_000

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Higieniza texto livre que entra no template (nome do aluno / título do curso) antes de ir
 * ao pdfSynth (HTML → Chrome). Remove `< > { }` (tags HTML e delimitadores do Tera) e caracteres
 * de controle — fecha injeção de HTML/SSTI mesmo que o autoescape do Tera esteja desligado.
 * O aluno controla o próprio displayName, então esse dado NÃO é confiável.
 */
function sanitizeText(s: string): string {
  // Remove `< > { }` (tags HTML e delimitadores do Tera) e caracteres de controle,
  // filtrando por codepoint (evita literal de controle no source).
  return Array.from(s)
    .filter((ch) => {
      if ('<>{}'.includes(ch)) return false
      const c = ch.codePointAt(0)
      return c === undefined || (c >= 0x20 && c !== 0x7f)
    })
    .join('')
    .trim()
}

/** Gera o PDF do certificado via pdfSynth (HTML → Chrome → PDF/A). Sem navegador local. */
@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name)
  private templateHtml?: string
  private bgDataUri?: string

  constructor(private readonly config: ConfigService) {}

  /** Endereço do renderizador (pdfSynth). Sem padrão no código: cada ambiente aponta para o seu. */
  private get baseUrl(): string {
    const url = this.config.get<string>('PDF_SYNTH_URL')
    if (!url) throw new Error('PDF_SYNTH_URL não configurado: defina o endereço do renderizador de PDF do certificado.')
    return url.replace(/\/+$/, '')
  }

  private get retryDelayMs(): number {
    const v = this.config.get<string | number>('PDF_SYNTH_RETRY_MS')
    return v === undefined ? RETRY_DELAY_MS : Number(v)
  }

  private loadTemplate(): string {
    if (this.templateHtml === undefined) this.templateHtml = readFileSync(TEMPLATE_HTML_PATH, 'utf8')
    return this.templateHtml
  }

  /** Arte de fundo como data URI. Ausente (dev/teste) → string vazia (template não desenha fundo). */
  private loadBgDataUri(): string {
    if (this.bgDataUri === undefined) {
      try {
        this.bgDataUri = `data:image/png;base64,${readFileSync(TEMPLATE_BG_PATH).toString('base64')}`
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          this.logger.warn(`Falha ao carregar imagem de fundo do certificado: ${err}`)
        }
        this.bgDataUri = ''
      }
    }
    return this.bgDataUri
  }

  /** Identity token do metadata server (Cloud Run) p/ invocar o pdfSynth (IAM). Fora do Cloud Run: sem auth. */
  private async authHeader(): Promise<Record<string, string>> {
    if (!this.config.get<string>('K_SERVICE')) return {}
    const url =
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity' +
      `?audience=${encodeURIComponent(this.baseUrl)}`
    const res = await fetch(url, { headers: { 'Metadata-Flavor': 'Google' } })
    if (!res.ok) throw new Error(`Falha ao obter identity token do metadata server (${res.status})`)
    return { Authorization: `Bearer ${await res.text()}` }
  }

  private buildData(d: CertData): Record<string, string> {
    return {
      // Texto livre controlado pelo usuário → higieniza antes de ir ao Chrome (anti-injeção HTML/SSTI).
      studentName: sanitizeText(d.studentName),
      cpf: d.cpf ?? '',
      courseTitle: sanitizeText(d.courseTitle),
      hours: String(d.hours),
      code: d.code,
      issuedAtBr: d.issuedAt.toLocaleDateString('pt-BR'),
      verifyUrl: d.verifyUrl,
      qrDataUri: d.qrDataUri,
      bgDataUri: this.loadBgDataUri(),
      // Também é texto livre vindo do admin → mesma higienização do studentName.
      coordinatorName: d.coordinatorName ? sanitizeText(d.coordinatorName) : '',
      coordinatorRole: d.coordinatorRole ? sanitizeText(d.coordinatorRole) : '',
      // Não passa por sanitizeText: é data URI gerada por nós, não texto do admin.
      coordinatorSignatureDataUri: d.coordinatorSignatureDataUri ?? '',
    }
  }

  /** Gera o PDF. `templateHtml` sobrepõe o HTML de fábrica (usado pelo template salvo/editor). */
  async generate(d: CertData, templateHtml?: string): Promise<Buffer> {
    const html = templateHtml ?? this.loadTemplate()
    // Sandbox de rede (ID-10): a API do pdfSynth não tem opção de desligar o egress do Chrome,
    // então o bloqueio é AQUI — nenhum HTML com referência externa chega ao renderizador.
    // (O save do template também valida; esta é a última linha, cobre qualquer caminho.)
    const violation = findTemplateNetworkViolation(html)
    if (violation) {
      throw new Error(`Template do certificado reprovado no sandbox de rede: ${violation}`)
    }
    const body = JSON.stringify({
      template_html: html,
      data: this.buildData(d),
      options: { pdf_a: true, paper_format: 'A4' },
    })
    const auth = await this.authHeader()

    let lastErr: Error | undefined
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.renderOnce(body, auth)
      } catch (err) {
        const e = err as Error & { noRetry?: boolean }
        lastErr = e
        if (e.noRetry || attempt === MAX_RETRIES) break
        this.logger.warn(`pdfSynth tentativa ${attempt} falhou: ${e.message}. Retry em ${this.retryDelayMs}ms`)
        await delay(this.retryDelayMs)
      }
    }
    throw new Error(`Falha ao gerar PDF no pdfSynth: ${lastErr?.message ?? 'desconhecido'}`)
  }

  private async renderOnce(body: string, auth: Record<string, string>): Promise<Buffer> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(`${this.baseUrl}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body,
        signal: ctrl.signal,
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        const err = new Error(`pdfSynth respondeu ${res.status}: ${detail}`) as Error & { noRetry?: boolean }
        if (res.status >= 400 && res.status < 500) err.noRetry = true // erro do payload → não retenta
        throw err
      }
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.subarray(0, 5).toString() !== '%PDF-' || buf.length < 1024) {
        throw new Error('Resposta do pdfSynth não é um PDF válido')
      }
      return buf
    } finally {
      clearTimeout(timer)
    }
  }
}
