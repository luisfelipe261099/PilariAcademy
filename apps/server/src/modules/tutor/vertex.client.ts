import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

const METADATA = 'http://metadata.google.internal/computeMetadata/v1'

interface TokenCache {
  token: string
  expiraEm: number
}

/**
 * Chamadas ao Gemini no Vertex AI por REST. A credencial é a identidade do próprio Cloud Run (servidor de metadados,
 * conta de serviço com papel de editor no projeto): nenhuma chave nova. Em desenvolvimento local, VERTEX_ACCESS_TOKEN
 * (ex.: `gcloud auth print-access-token`) e VERTEX_PROJECT substituem o servidor de metadados.
 */
@Injectable()
export class VertexClient {
  private readonly logger = new Logger(VertexClient.name)
  private cache: TokenCache | null = null
  private projeto: string | null = null

  constructor(private readonly config: ConfigService) {}

  get modeloTexto(): string {
    return this.config.get<string>('TUTOR_MODEL') || 'gemini-3.5-flash-lite'
  }

  get modeloVoz(): string {
    return this.config.get<string>('TUTOR_TTS_MODEL') || 'gemini-2.5-flash-lite-preview-tts'
  }

  get voz(): string {
    return this.config.get<string>('TUTOR_TTS_VOICE') || 'Kore'
  }

  private get local(): string {
    return this.config.get<string>('VERTEX_LOCATION') || 'global'
  }

  private async token(): Promise<string> {
    const doAmbiente = this.config.get<string>('VERTEX_ACCESS_TOKEN')
    if (doAmbiente) return doAmbiente
    if (this.cache && this.cache.expiraEm > Date.now() + 60_000) return this.cache.token
    // O metadata server do Google só existe em HTTP, no endereço interno da própria máquina do Cloud Run (não sai do host).
    // nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request
    const r = await fetch(`${METADATA}/instance/service-accounts/default/token`, { headers: { 'Metadata-Flavor': 'Google' } })
    if (!r.ok) throw new Error(`metadados do Cloud Run responderam ${r.status} ao pedir o token`)
    const j = (await r.json()) as { access_token: string; expires_in: number }
    this.cache = { token: j.access_token, expiraEm: Date.now() + j.expires_in * 1000 }
    return j.access_token
  }

  private async project(): Promise<string> {
    if (this.projeto) return this.projeto
    const doAmbiente = this.config.get<string>('VERTEX_PROJECT') || this.config.get<string>('GOOGLE_CLOUD_PROJECT')
    if (doAmbiente) return (this.projeto = doAmbiente)
    // O metadata server do Google só existe em HTTP, no endereço interno da própria máquina do Cloud Run (não sai do host).
    // nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request
    const r = await fetch(`${METADATA}/project/project-id`, { headers: { 'Metadata-Flavor': 'Google' } })
    if (!r.ok) throw new Error(`metadados do Cloud Run responderam ${r.status} ao pedir o projeto`)
    return (this.projeto = (await r.text()).trim())
  }

  private async url(modelo: string, metodo: 'generateContent' | 'streamGenerateContent'): Promise<string> {
    const loc = this.local
    const host = loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`
    const sufixo = metodo === 'streamGenerateContent' ? '?alt=sse' : ''
    return `https://${host}/v1/projects/${await this.project()}/locations/${loc}/publishers/google/models/${modelo}:${metodo}${sufixo}`
  }

  private async post(modelo: string, metodo: 'generateContent' | 'streamGenerateContent', body: unknown, signal?: AbortSignal): Promise<Response> {
    let r: Response
    try {
      r = await fetch(await this.url(modelo, metodo), {
        method: 'POST',
        headers: { Authorization: `Bearer ${await this.token()}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      })
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err
      this.logger.error(`Vertex ${modelo}: falha de rede`, err as Error)
      throw new ServiceUnavailableException('O tutor está indisponível agora. Tente de novo em instantes.')
    }
    if (!r.ok) {
      const detalhe = (await r.text().catch(() => '')).slice(0, 300)
      this.logger.error(`Vertex ${modelo} respondeu ${r.status}: ${detalhe}`)
      throw new ServiceUnavailableException('O tutor está indisponível agora. Tente de novo em instantes.')
    }
    return r
  }

  /** Texto da resposta (já em JSON, pelo responseSchema) e o uso de tokens, para o log de custo. */
  async gerar(body: Record<string, unknown>): Promise<{ texto: string; uso: Record<string, unknown> | undefined }> {
    const r = await this.post(this.modeloTexto, 'generateContent', body)
    const j = (await r.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: Record<string, unknown> }
    const texto = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
    return { texto, uso: j.usageMetadata }
  }

  /**
   * Voz em fluxo: devolve os pedaços de PCM 16 bits 24 kHz à medida que o Gemini TTS gera. O primeiro pedaço chega em
   * ~1,2 s e a geração é mais rápida que a fala, então o navegador toca sem esperar o fim.
   */
  async *falar(texto: string, signal?: AbortSignal): AsyncGenerator<Buffer> {
    const body = {
      contents: [{ role: 'user', parts: [{ text: `Fale em português do Brasil, com tom calmo, acolhedor e didático de professora: ${texto}` }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { languageCode: 'pt-BR', voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voz } } },
      },
    }
    const r = await this.post(this.modeloVoz, 'streamGenerateContent', body, signal)
    if (!r.body) return
    const dec = new TextDecoder()
    let buf = ''
    for await (const pedaco of r.body as unknown as AsyncIterable<Uint8Array>) {
      buf += dec.decode(pedaco, { stream: true }).replace(/\r/g, '')
      let fim: number
      while ((fim = buf.indexOf('\n\n')) >= 0) {
        const evento = buf.slice(0, fim)
        buf = buf.slice(fim + 2)
        const linha = evento.split('\n').find((l) => l.startsWith('data: '))
        if (!linha) continue
        try {
          const j = JSON.parse(linha.slice(6)) as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }> }
          for (const p of j.candidates?.[0]?.content?.parts ?? []) if (p.inlineData?.data) yield Buffer.from(p.inlineData.data, 'base64')
        } catch {
          this.logger.warn('Vertex TTS: evento SSE ilegível ignorado')
        }
      }
    }
  }
}
