import { DEFAULT_TENANT_BASE_DOMAIN, RESERVED_TENANT_SLUGS, TENANT_SLUG_PATTERN } from './tenancy.constants'

export interface HostConfig {
  /** Domínio base dos subdomínios de polo, ex.: cursos.studiopilari.com.br. */
  baseDomain: string
  /** Sufixos aceitos fora de produção: polo-a.localhost, polo-a.test. */
  devSuffixes: readonly string[]
  isProd: boolean
}

/** Header Host → forma canônica (minúsculo, sem porta, sem ponto final). null se inválido. */
export function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null
  const h = raw.trim().toLowerCase()
  if (!h) return null
  if (h.startsWith('[')) {
    const end = h.indexOf(']')
    return end > 0 ? h.slice(0, end + 1) : null
  }
  const semPorta = h.replace(/:\d+$/, '').replace(/\.+$/, '')
  if (!/^[a-z0-9.-]{1,253}$/.test(semPorta) || semPorta.includes('..') || semPorta.startsWith('.')) return null
  return semPorta
}

/** Slug do polo pelo subdomínio da plataforma; fora de produção, também pelos sufixos de dev. */
export function slugFromHost(host: string, cfg: HostConfig): string | null {
  const sufixos = [cfg.baseDomain, ...(cfg.isProd ? [] : cfg.devSuffixes)]
  for (const sufixo of sufixos) {
    const cauda = `.${sufixo}`
    if (!host.endsWith(cauda)) continue
    const rotulo = host.slice(0, -cauda.length)
    return rotulo && !rotulo.includes('.') ? rotulo : null
  }
  return null
}

/** Domínios padrão das plataformas de hospedagem (Cloud Run e Vercel): o endereço gerado do deploy é a matriz. */
const DOMINIOS_DE_PLATAFORMA = ['run.app', 'vercel.app'] as const

/** Hosts que caem na matriz sem cadastro: URL padrão do Cloud Run ou da Vercel e, fora de produção, localhost. */
export function isMatrizFallbackHost(host: string, cfg: HostConfig): boolean {
  for (const dominio of DOMINIOS_DE_PLATAFORMA) {
    if (!host.endsWith(`.${dominio}`)) continue
    // Defesa extra: exige rótulo não vazio antes do sufixo, mesmo se o host não vier normalizado.
    const rotulo = host.slice(0, -(dominio.length + 1))
    return rotulo.length > 0 && !rotulo.endsWith('.')
  }
  return !cfg.isProd && (host === 'localhost' || host === '127.0.0.1' || host === '[::1]')
}

/**
 * Hosts que a resolução do polo trata de forma especial (`slugFromHost` e `isMatrizFallbackHost`) e que, por isso,
 * nunca podem ser cadastrados como domínio próprio de um polo: o domínio cadastrado vence o fallback, então registrar
 * a URL padrão do Cloud Run tiraria a matriz do ar nesse endereço, e um IP ou um nome de dev tomaria o lugar do
 * fallback local. São eles: literais de IP, `*.run.app`, `*.vercel.app`, `localhost`, `*.localhost`, `*.test` e, fora de produção,
 * os sufixos de dev configurados. Recebe o host já normalizado (`normalizeHost`).
 */
export function isReservedHost(host: string, cfg: HostConfig): boolean {
  if (host.startsWith('[')) return true // IPv6 literal
  // IPv4 literal: o último rótulo de um nome de domínio nunca é só dígitos (a IANA não tem TLD numérico).
  if (/(^|\.)\d+$/.test(host)) return true
  if (DOMINIOS_DE_PLATAFORMA.some((d) => host === d || host.endsWith(`.${d}`))) return true
  // localhost e test são reservados pela IETF (RFC 2606 e 6761) e nunca resolvem na internet, em qualquer ambiente.
  const sufixosDev = ['localhost', 'test', ...(cfg.isProd ? [] : cfg.devSuffixes)]
  return sufixosDev.some((s) => host === s || host.endsWith(`.${s}`))
}

export function isValidTenantSlug(slug: string): boolean {
  return TENANT_SLUG_PATTERN.test(slug) && !slug.includes('--') && !RESERVED_TENANT_SLUGS.has(slug)
}

export function hostConfigFromEnv(env: { TENANT_BASE_DOMAIN?: string; TENANT_DEV_SUFFIXES?: string; NODE_ENV?: string }): HostConfig {
  return {
    baseDomain: (env.TENANT_BASE_DOMAIN || DEFAULT_TENANT_BASE_DOMAIN).trim().toLowerCase(),
    devSuffixes: (env.TENANT_DEV_SUFFIXES || 'localhost,test')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    isProd: env.NODE_ENV === 'production',
  }
}
