import { posix } from 'node:path'
import type { PublicTenant } from '@pilari/types'
import { nomeCurtoDoApp } from '../tenant-site/app-manifest'
import { toPublicTenant } from './public-tenant'
import type { TenantContext } from './tenant-context'

const escHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/**
 * JSON seguro dentro de <script type="application/json">: sem "<" literal não há como fechar a tag
 * nem abrir um comentário. U+2028 e U+2029 também saem escapados (quebram linha em JS antigo).
 */
export function jsonForHtml(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

/**
 * Favicon de reserva para polo sem imagem: a inicial do nome sobre a cor do polo. A inicial é a
 * primeira letra ou dígito, nunca o primeiro caractere: um emoji no começo do nome (par de
 * surrogates) cortado ao meio faria o encodeURIComponent lançar URIError e derrubaria a página
 * do polo. Letra ou dígito também dispensa escape dentro do SVG.
 */
export function initialFavicon(name: string, color: string): string {
  const letra = (name.match(/[\p{L}\p{N}]/u)?.[0] ?? 'P').toUpperCase()
  const cor = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#5c6e5a'
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${cor}"/>` +
    `<text x="32" y="44" font-family="Arial,Helvetica,sans-serif" font-size="36" font-weight="700" text-anchor="middle" fill="#ffffff">${letra}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const absoluta = (siteUrl: string, url: string): string => (/^https?:\/\//i.test(url) ? url : `${siteUrl}${url}`)

/**
 * index.html do polo. O polo troca título, descrição e favicon e recebe o tema; a matriz mantém o
 * HTML do build e só ganha as tags og e o bloco de dados. Os dois blocos novos passam pelo CSP atual:
 * style-src aceita 'unsafe-inline' e um script application/json não executa, então os hashes do
 * helmet (calculados do HTML buildado) seguem valendo. Substituições por função: um "$" no nome do
 * polo não pode virar padrão especial do String.replace.
 */
export function renderIndexHtml(base: string, input: { tenant: PublicTenant; siteUrl: string; versao?: string }): string {
  const { tenant, siteUrl, versao = '' } = input
  const b = tenant.branding
  const titulo = `Cursos | ${tenant.name}`
  const descricao = b.description ?? `${tenant.name}: cursos online com certificado de conclusão.`
  let html = base
  if (!tenant.isMatriz) {
    html = html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escHtml(titulo)}</title>`)
    html = html.replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?>/, () => `<meta name="description" content="${escHtml(descricao)}" />`)
    const icone = b.faviconUrl ?? initialFavicon(tenant.name, b.primaryColor)
    html = html.replace(/<link\s+rel="icon"[^>]*>/, () => `<link rel="icon" href="${escHtml(icone)}" />`)
    // App (PWA): ícone da tela inicial do iPhone, cor da barra e nome embaixo do ícone, todos do polo.
    const icone180 = `/api/tenant/app-icon/apple-180?v=${encodeURIComponent(versao)}`
    html = html.replace(/<link\s+rel="apple-touch-icon"[^>]*>/, () => `<link rel="apple-touch-icon" href="${escHtml(icone180)}" />`)
    html = html.replace(/<meta\s+name="theme-color"[^>]*>/, () => `<meta name="theme-color" content="${escHtml(b.primaryColor)}" />`)
    html = html.replace(/<meta\s+name="apple-mobile-web-app-title"[^>]*>/, () => `<meta name="apple-mobile-web-app-title" content="${escHtml(nomeCurtoDoApp(tenant.name))}" />`)
  }
  const og: Array<[string, string]> = [
    ['og:type', 'website'],
    ['og:site_name', tenant.name],
    ['og:title', titulo],
    ['og:description', descricao],
    ['og:url', siteUrl],
  ]
  if (b.logoUrl) og.push(['og:image', absoluta(siteUrl, b.logoUrl)])
  const linhas = og.map(([p, c]) => `<meta property="${p}" content="${escHtml(c)}" />`)
  if (tenant.themeCss) linhas.push(`<style id="tenant-theme">${tenant.themeCss.replace(/</g, '')}</style>`)
  linhas.push(`<script type="application/json" id="tenant-data">${jsonForHtml(tenant)}</script>`)
  const bloco = linhas.join('\n    ')
  return html.includes('</head>') ? html.replace('</head>', () => `  ${bloco}\n  </head>`) : `${bloco}\n${html}`
}

/**
 * O pedido é pelo index.html cru? O express.static decodifica o caminho, junta "//" e resolve "./" e
 * "../" antes de abrir o arquivo, então a comparação passa pelo mesmo caminho: só `=== '/index.html'`
 * deixaria "//index.html" ou "/%69ndex.html" entregarem o HTML da matriz no endereço de um polo.
 */
export function isIndexHtmlPath(urlPath: string): boolean {
  let decodificado: string
  try {
    decodificado = decodeURIComponent(urlPath)
  } catch {
    return false // malformado: o express.static também não abre, e o pedido cai no fallback
  }
  return posix.normalize(`/${decodificado}`).toLowerCase() === '/index.html'
}

/** Teto de versões guardadas: cada troca de marca deixa uma versão velha para trás até o cache esvaziar. */
export const INDEX_CACHE_CAP = 500

/** HTML por versão do polo: sem mudança de marca, o mesmo polo não renderiza de novo. */
export class IndexRenderer {
  private readonly cache = new Map<string, string>()

  constructor(
    private readonly base: string,
    private readonly siteUrlOf: (t: TenantContext) => string
  ) {}

  render(t: TenantContext): string {
    const chave = `${t.id}:${t.updatedAt.getTime()}`
    const pronto = this.cache.get(chave)
    if (pronto) return pronto
    if (this.cache.size >= INDEX_CACHE_CAP) this.cache.clear()
    const html = renderIndexHtml(this.base, { tenant: toPublicTenant(t), siteUrl: this.siteUrlOf(t), versao: String(t.updatedAt.getTime()) })
    this.cache.set(chave, html)
    return html
  }
}
