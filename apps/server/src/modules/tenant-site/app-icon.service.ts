import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Injectable, Logger } from '@nestjs/common'
import { createCanvas, GlobalFonts, loadImage, type SKRSContext2D } from '@napi-rs/canvas'
import { GcsService, MAX_IMAGE_BYTES } from '../classroom/gcs.service'
import { isAllowedBrandingUrl } from '../tenancy/branding'
import type { TenantContext } from '../tenancy/tenant-context'
import { inicialDoPolo, MEDIDAS_ICONE, svgNoTamanho, type VarianteIcone } from './app-manifest'

const FAMILIA = 'InterIcone'
/** Fonte do site para a inicial: a imagem do Cloud Run não tem fontes do sistema. Produção: /app/public/fonts. */
const FONTES_CANDIDATAS = [
  join(__dirname, '..', '..', '..', 'public', 'fonts', 'inter-700.woff2'),
  join(process.cwd(), '..', 'client', 'public', 'fonts', 'inter-700.woff2'),
]
const TIPOS_DE_IMAGEM = /^image\/(png|jpeg|webp|gif|svg\+xml)$/i
/** Cada troca de marca deixa os ícones velhos para trás até o cache esvaziar. */
const TETO_CACHE = 200

let fonteRegistrada: boolean | null = null
function registrarFonte(): boolean {
  if (fonteRegistrada !== null) return fonteRegistrada
  const caminho = FONTES_CANDIDATAS.find((c) => existsSync(c))
  fonteRegistrada = !!caminho && !!GlobalFonts.registerFromPath(caminho, FAMILIA)
  return fonteRegistrada
}

function fundo(g: SKRSContext2D, lado: number, raio: number, cor: string): void {
  g.fillStyle = cor
  g.beginPath()
  if (raio > 0) g.roundRect(0, 0, lado, lado, lado * raio)
  else g.rect(0, 0, lado, lado)
  g.fill()
}

/**
 * Ícone do app de um polo. Com logo própria (favicon de preferência, por ser quadrado; senão a logo), a marca vai
 * centralizada num fundo branco. Sem imagem, a inicial do polo sobre a cor dele, igual ao favicon de reserva.
 */
export async function desenharIcone(
  entrada: { imagem: Buffer | null; ehSvg: boolean; nome: string; cor: string },
  variante: VarianteIcone
): Promise<Buffer> {
  const { lado, escala, raio } = MEDIDAS_ICONE[variante]
  const canvas = createCanvas(lado, lado)
  const g = canvas.getContext('2d')
  const caixa = lado * escala

  if (entrada.imagem) {
    try {
      const fonte = entrada.ehSvg ? Buffer.from(svgNoTamanho(entrada.imagem.toString('utf8'), Math.round(caixa))) : entrada.imagem
      const img = await loadImage(fonte)
      if (img.width > 0 && img.height > 0) {
        fundo(g, lado, raio, '#ffffff')
        const k = caixa / Math.max(img.width, img.height)
        const w = img.width * k
        const h = img.height * k
        g.drawImage(img, (lado - w) / 2, (lado - h) / 2, w, h)
        return canvas.encode('png')
      }
    } catch {
      // imagem que o rasterizador não entende: cai na inicial
    }
  }

  fundo(g, lado, raio, /^#[0-9a-fA-F]{6}$/.test(entrada.cor) ? entrada.cor : '#5c6e5a')
  g.fillStyle = '#ffffff'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = `bold ${Math.round(caixa * 0.78)}px ${registrarFonte() ? FAMILIA : 'sans-serif'}`
  g.fillText(inicialDoPolo(entrada.nome), lado / 2, lado / 2 + caixa * 0.04)
  return canvas.encode('png')
}

@Injectable()
export class AppIconService {
  private readonly logger = new Logger(AppIconService.name)
  private readonly cache = new Map<string, Buffer>()

  constructor(private readonly gcs: GcsService) {}

  async doPolo(tenant: TenantContext, variante: VarianteIcone): Promise<Buffer> {
    const chave = `${tenant.id}:${tenant.updatedAt.getTime()}:${variante}`
    const pronto = this.cache.get(chave)
    if (pronto) return pronto
    const imagem = await this.imagemDaMarca(tenant)
    const png = await desenharIcone({ ...imagem, nome: tenant.name, cor: tenant.branding.primaryColor }, variante)
    if (this.cache.size >= TETO_CACHE) this.cache.clear()
    this.cache.set(chave, png)
    return png
  }

  /**
   * Favicon ou logo do bucket do PRÓPRIO polo. URL externa não é buscada pelo servidor (não abre requisição para
   * endereço escolhido pelo polo): nesse caso o ícone sai com a inicial.
   */
  private async imagemDaMarca(tenant: TenantContext): Promise<{ imagem: Buffer | null; ehSvg: boolean }> {
    for (const valor of [tenant.branding.faviconUrl, tenant.branding.logoUrl]) {
      if (!valor || !isAllowedBrandingUrl(valor, tenant.id) || /^https?:\/\//i.test(valor)) continue
      try {
        const obj = await this.gcs.readObject(valor, { maxBytes: MAX_IMAGE_BYTES })
        if (obj && TIPOS_DE_IMAGEM.test(obj.contentType)) return { imagem: obj.buffer, ehSvg: /svg/i.test(obj.contentType) }
      } catch (err) {
        this.logger.warn(`ícone do app: não li a marca do polo ${tenant.id}: ${(err as Error).message}`)
      }
    }
    return { imagem: null, ehSvg: false }
  }
}
