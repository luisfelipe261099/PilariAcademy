import type { BrandingAssetKind, TenantBranding, TenantBrandingInput } from '@pilari/types'

export interface BrandingFormState {
  logoUrl: string | null
  logoLightUrl: string | null
  faviconUrl: string | null
  primaryColor: string
  /**
   * Cor dos botões de ação. Nenhum componente do client usa os tokens laranja, então a tela não a mostra: o formulário
   * guarda o valor salvo e o devolve como veio, porque o servidor segue aceitando o campo.
   */
  accentColor: string
  whatsapp: string
  phone: string
  email: string
  address: string
  description: string
  heroTitle: string
  heroSubtitle: string
}

export function brandingToForm(b: TenantBranding): BrandingFormState {
  return {
    logoUrl: b.logoUrl, logoLightUrl: b.logoLightUrl, faviconUrl: b.faviconUrl,
    primaryColor: b.primaryColor, accentColor: b.accentColor,
    whatsapp: b.whatsapp ?? '', phone: b.phone ?? '', email: b.email ?? '', address: b.address ?? '',
    description: b.description ?? '', heroTitle: b.heroTitle ?? '', heroSubtitle: b.heroSubtitle ?? '',
  }
}

const vazioViraNull = (v: string): string | null => (v.trim() ? v.trim() : null)

export function formToBrandingInput(f: BrandingFormState): TenantBrandingInput {
  return {
    logoUrl: f.logoUrl,
    logoLightUrl: f.logoLightUrl,
    faviconUrl: f.faviconUrl,
    primaryColor: f.primaryColor.trim().toLowerCase(),
    accentColor: f.accentColor.trim().toLowerCase(),
    whatsapp: vazioViraNull(f.whatsapp.replace(/\D/g, '')),
    phone: vazioViraNull(f.phone),
    email: vazioViraNull(f.email),
    address: vazioViraNull(f.address),
    description: vazioViraNull(f.description),
    heroTitle: vazioViraNull(f.heroTitle),
    heroSubtitle: vazioViraNull(f.heroSubtitle),
  }
}

const HEX = /^#[0-9a-fA-F]{6}$/

/** Erros de preenchimento, com as mesmas regras do servidor (mergeBranding). Lista vazia = pode salvar. */
export function brandingFormErrors(f: BrandingFormState): string[] {
  const erros: string[] = []
  if (!HEX.test(f.primaryColor.trim())) erros.push('Cor principal inválida. Use o formato #RRGGBB.')
  if (!HEX.test(f.accentColor.trim())) erros.push('Cor dos botões inválida. Use o formato #RRGGBB.')
  const wa = f.whatsapp.replace(/\D/g, '')
  if (wa && !/^\d{12,13}$/.test(wa)) erros.push('WhatsApp inválido. Informe DDI, DDD e número, ex.: 5541999999999.')
  if (f.phone.trim().length > 40) erros.push('O telefone passa de 40 caracteres.')
  if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) erros.push('E-mail inválido.')
  if (f.email.trim().length > 160) erros.push('O e-mail passa de 160 caracteres.')
  if (f.address.trim().length > 300) erros.push('O endereço passa de 300 caracteres.')
  if (f.description.trim().length > 300) erros.push('A descrição passa de 300 caracteres.')
  if (f.heroTitle.trim().length > 120) erros.push('O título da página inicial passa de 120 caracteres.')
  if (f.heroSubtitle.trim().length > 300) erros.push('O subtítulo da página inicial passa de 300 caracteres.')
  return erros
}

/** Prévia da marca de outro polo no console: caminhos do bucket passam pelo proxy público do site dele. */
export function previewFromSite(b: TenantBranding, siteUrl: string): TenantBranding {
  const via = (kind: BrandingAssetKind, v: string | null): string | null =>
    v && !/^https?:\/\//i.test(v) ? `${siteUrl}/api/tenant/assets/${kind}` : v
  return { ...b, logoUrl: via('logo', b.logoUrl), logoLightUrl: via('logo-light', b.logoLightUrl), faviconUrl: via('favicon', b.faviconUrl) }
}
