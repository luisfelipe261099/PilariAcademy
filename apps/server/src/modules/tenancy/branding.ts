import { BadRequestException } from '@nestjs/common'
import type { BrandingAssetKind, TenantBranding, TenantBrandingInput } from '@pilari/types'

export const DEFAULT_PRIMARY_COLOR = '#5c6e5a'
export const DEFAULT_ACCENT_COLOR = '#c67c89'

export const EMPTY_BRANDING: TenantBranding = {
  logoUrl: null,
  logoLightUrl: null,
  faviconUrl: null,
  primaryColor: DEFAULT_PRIMARY_COLOR,
  accentColor: DEFAULT_ACCENT_COLOR,
  whatsapp: null,
  phone: null,
  email: null,
  address: null,
  description: null,
  heroTitle: null,
  heroSubtitle: null,
}

const HEX = /^#[0-9a-fA-F]{6}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
type UrlField = 'logoUrl' | 'logoLightUrl' | 'faviconUrl'
const URL_FIELDS: UrlField[] = ['logoUrl', 'logoLightUrl', 'faviconUrl']
const ASSET_KIND: Record<UrlField, string> = { logoUrl: 'logo', logoLightUrl: 'logo-light', faviconUrl: 'favicon' }
const TEXT_LIMITS = { phone: 40, email: 160, address: 300, description: 300, heroTitle: 120, heroSubtitle: 300 } as const
type TextField = keyof typeof TEXT_LIMITS
const TEXT_LABELS: Record<TextField, string> = {
  phone: 'telefone',
  email: 'e-mail',
  address: 'endereço',
  description: 'descrição',
  heroTitle: 'título da página inicial',
  heroSubtitle: 'subtítulo da página inicial',
}

/** Campos de texto livre da marca que viram cópia do site do polo (B7). */
const COPY_FIELDS: ReadonlySet<TextField> = new Set<TextField>(['description', 'heroTitle', 'heroSubtitle'])
/**
 * "reconhecido pelo MEC" e "certificado pelo MEC", no masculino e no feminino, no singular e no plural, já sem acento,
 * em minúsculas e com espaço simples.
 */
const COPIA_MEC_PROIBIDA = /\b(reconhecid[oa]s?|certificad[oa]s?) pelo mec\b/
const FRASE_DO_MEC = 'Curso livre com certificado de conclusão'
/** Invisíveis que partiriam a expressão sem aparecer na tela: zero-width, word joiner, BOM e hífen opcional. */
const INVISIVEIS = /[\u200b-\u200d\u2060\ufeff\u00ad\u180e]/g
/** Hífens e travessões viram espaço: "reconhecido-pelo-MEC" é a mesma frase. */
const TRACOS = /[-\u2010-\u2015\u2212]/g

/**
 * A cópia dos sites (da matriz e dos polos) nunca diz que o curso é "reconhecido pelo MEC" nem "certificado pelo MEC": o curso livre não
 * é, e o certificado é de conclusão, emitido pelo Studio Pilari. Compara sem diferenciar
 * maiúsculas, acentos, gênero e número, hífens, espaços repetidos e caracteres invisíveis, e a recusa sugere a frase
 * certa no lugar do termo encontrado.
 */
function recusarCopiaDoMec(texto: string): void {
  const normalizado = texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(INVISIVEIS, '')
    .replace(TRACOS, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
  const achado = COPIA_MEC_PROIBIDA.exec(normalizado)
  if (achado) throw new BadRequestException(`Use "${FRASE_DO_MEC}" em vez de "${achado[1]} pelo MEC".`)
}

function clean(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'string') throw new BadRequestException('Valor de marca inválido.')
  const s = v.trim()
  return s.length ? s : null
}

/** Imagem da marca: https:// externo ou objeto do bucket sob polos/<tenantId>/marca/. */
export function isAllowedBrandingUrl(value: string, tenantId: string): boolean {
  if (value.length > 1024 || /[\s"'<>]/.test(value)) return false
  if (/^https:\/\/\S+$/i.test(value)) return true
  return value.startsWith(`polos/${tenantId}/marca/`) && !value.includes('..')
}

/**
 * Aplica o patch sobre a marca atual, valida e devolve a marca completa. Mensagens em pt-BR. Nos polos, descrição, título
 * e subtítulo não aceitam "reconhecido pelo MEC" nem "certificado pelo MEC" (B7).
 */
export function mergeBranding(base: TenantBranding, input: TenantBrandingInput | undefined, tenantId: string): TenantBranding {
  const out: TenantBranding = { ...EMPTY_BRANDING, ...base }
  if (!input) return out

  if (input.primaryColor !== undefined) {
    if (typeof input.primaryColor !== 'string' || !HEX.test(input.primaryColor)) {
      throw new BadRequestException('Cor principal inválida. Use o formato #RRGGBB.')
    }
    out.primaryColor = input.primaryColor.toLowerCase()
  }
  if (input.accentColor !== undefined) {
    if (typeof input.accentColor !== 'string' || !HEX.test(input.accentColor)) {
      throw new BadRequestException('Cor dos botões inválida. Use o formato #RRGGBB.')
    }
    out.accentColor = input.accentColor.toLowerCase()
  }
  for (const f of URL_FIELDS) {
    if (input[f] === undefined) continue
    const v = clean(input[f])
    if (v && !isAllowedBrandingUrl(v, tenantId)) {
      throw new BadRequestException('Endereço de imagem inválido. Use um link https:// ou envie o arquivo pelo painel.')
    }
    out[f] = v
  }
  if (input.whatsapp !== undefined) {
    const v = clean(input.whatsapp)
    const digitos = v ? v.replace(/\D/g, '') : null
    if (digitos && !/^\d{12,13}$/.test(digitos)) {
      throw new BadRequestException('WhatsApp inválido. Informe DDI, DDD e número, ex.: 5541999999999.')
    }
    out.whatsapp = digitos
  }
  for (const f of Object.keys(TEXT_LIMITS) as TextField[]) {
    if (input[f] === undefined) continue
    const v = clean(input[f])
    if (v && v.length > TEXT_LIMITS[f]) {
      throw new BadRequestException(`Texto longo demais em ${TEXT_LABELS[f]} (máximo de ${TEXT_LIMITS[f]} caracteres).`)
    }
    if (f === 'email' && v && !EMAIL.test(v)) throw new BadRequestException('E-mail inválido.')
    // A cópia da matriz não muda nesta etapa: só os polos são barrados (B7).
    if (v && COPY_FIELDS.has(f)) recusarCopiaDoMec(v)
    out[f] = v
  }
  return out
}

/** Marca com URLs públicas: caminhos do bucket viram /api/tenant/assets/<kind>?v=<versão>. */
export function publicBranding(branding: TenantBranding, version: number): TenantBranding {
  const out: TenantBranding = { ...branding }
  for (const f of URL_FIELDS) {
    const v = branding[f]
    out[f] = v && !/^https?:\/\//i.test(v) ? `/api/tenant/assets/${ASSET_KIND[f]}?v=${version}` : v
  }
  return out
}

/** Campo da marca de cada imagem servida por /api/tenant/assets/:kind. */
export const ASSET_FIELD_BY_KIND: Record<BrandingAssetKind, 'logoUrl' | 'logoLightUrl' | 'faviconUrl'> = {
  logo: 'logoUrl',
  'logo-light': 'logoLightUrl',
  favicon: 'faviconUrl',
}

export function isBrandingAssetKind(v: string): v is BrandingAssetKind {
  return v === 'logo' || v === 'logo-light' || v === 'favicon'
}
