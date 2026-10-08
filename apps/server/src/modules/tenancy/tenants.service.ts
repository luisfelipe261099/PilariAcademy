import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import type { TenantBrandingInput, TenantStatus } from '@pilari/types'
import { isDuplicateEntry } from '../../common/lib/db-errors'
import { tenantDomains, tenants } from '../../db/schema'
import type { Database } from '../../db/types'
import { EMPTY_BRANDING, mergeBranding } from './branding'
import {
  hostConfigFromEnv, isMatrizFallbackHost, isReservedHost, isValidTenantSlug, normalizeHost, slugFromHost, type HostConfig,
} from './host'
import { toTenantContext, type TenantContext } from './tenant-context'
import { tenantNotFound } from './tenant-errors'
import { MATRIZ_TENANT_ID } from './tenancy.constants'

const POLO_JA_EXISTE = 'Já existe um polo com este endereço.'
const DOMINIO_EM_USO = 'Este domínio já está em uso.'

const TTL_CONHECIDO_MS = 60_000
const TTL_DESCONHECIDO_MS = 10_000

/**
 * Teto de entradas do cache de host. A chave vem do header Host (entrada não confiável): hoje o
 * Cloud Run só roteia hosts cadastrados, mas a etapa 3 liga o roteamento coringa, e aí varrer
 * subdomínios aleatórios faria o Map crescer sem limite. Ao atingir o teto, descarta primeiro as
 * entradas expiradas; se não for suficiente, descarta as mais antigas até caber a entrada nova.
 */
export const HOST_CACHE_CAP = 10_000

@Injectable()
export class TenantsService {
  readonly hostConfig: HostConfig
  private readonly cache = new Map<string, { value: TenantContext | null; expires: number }>()

  constructor(
    @Inject('DB_CLIENT') private readonly db: Database,
    config: ConfigService
  ) {
    this.hostConfig = hostConfigFromEnv({
      TENANT_BASE_DOMAIN: config.get<string>('TENANT_BASE_DOMAIN'),
      TENANT_DEV_SUFFIXES: config.get<string>('TENANT_DEV_SUFFIXES'),
      NODE_ENV: config.get<string>('NODE_ENV'),
    })
  }

  /** Polo do header Host. Cache por instância: 60 s para hosts conhecidos, 10 s para desconhecidos. */
  async resolveHost(raw: string | null | undefined, now: number = Date.now()): Promise<TenantContext | null> {
    const host = normalizeHost(raw)
    if (!host) return null
    const hit = this.cache.get(host)
    if (hit && hit.expires > now) return hit.value
    const value = await this.lookup(host)
    this.evictIfNeeded(now)
    this.cache.set(host, { value, expires: now + (value ? TTL_CONHECIDO_MS : TTL_DESCONHECIDO_MS) })
    return value
  }

  /** Libera espaço antes de inserir: expiradas primeiro, depois as mais antigas até caber abaixo do teto. */
  private evictIfNeeded(now: number): void {
    if (this.cache.size < HOST_CACHE_CAP) return
    for (const [host, entry] of this.cache) {
      if (entry.expires <= now) this.cache.delete(host)
    }
    while (this.cache.size >= HOST_CACHE_CAP) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) break
      this.cache.delete(oldest)
    }
  }

  private async lookup(host: string): Promise<TenantContext | null> {
    const porDominio = await this.db
      .select({ t: tenants })
      .from(tenantDomains)
      .innerJoin(tenants, eq(tenants.id, tenantDomains.tenantId))
      .where(eq(tenantDomains.host, host))
      .limit(1)
    if (porDominio[0]) return toTenantContext(porDominio[0].t)
    const slug = slugFromHost(host, this.hostConfig)
    if (slug) return this.getBySlug(slug)
    if (isMatrizFallbackHost(host, this.hostConfig)) return this.getById(MATRIZ_TENANT_ID)
    return null
  }

  async getById(id: string): Promise<TenantContext | null> {
    const rows = await this.db.select().from(tenants).where(eq(tenants.id, id)).limit(1)
    return rows[0] ? toTenantContext(rows[0]) : null
  }

  async getBySlug(slug: string): Promise<TenantContext | null> {
    const rows = await this.db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1)
    return rows[0] ? toTenantContext(rows[0]) : null
  }

  invalidateCache(): void {
    this.cache.clear()
  }

  /** Endereço público canônico do site do polo. */
  siteUrl(t: Pick<TenantContext, 'slug' | 'isMatriz'>): string {
    const base = this.hostConfig.baseDomain
    return t.isMatriz ? `https://${base}` : `https://${t.slug}.${base}`
  }

  async create(input: { slug: string; name: string; branding: TenantBrandingInput }): Promise<TenantContext> {
    const slug = input.slug.trim().toLowerCase()
    if (!isValidTenantSlug(slug)) {
      throw new BadRequestException('Endereço do polo inválido: use de 3 a 40 letras minúsculas, números e hífen, sem nomes reservados.')
    }
    const name = input.name.trim()
    if (name.length < 2 || name.length > 160) throw new BadRequestException('Informe o nome do polo (2 a 160 caracteres).')
    const existente = await this.db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1)
    if (existente[0]) throw new ConflictException(POLO_JA_EXISTE)
    const id = randomUUID()
    const branding = mergeBranding(EMPTY_BRANDING, input.branding, id)
    const now = new Date()
    try {
      // Numa transação só: se o domínio primário já existir, o polo recém-inserido volta atrás em vez de ficar sem endereço.
      await this.db.transaction(async (tx) => {
        await tx.insert(tenants).values({ id, slug, name, status: 'active', isMatriz: false, branding, createdAt: now, updatedAt: now })
        await tx.insert(tenantDomains).values({ host: `${slug}.${this.hostConfig.baseDomain}`, tenantId: id, isPrimary: true, createdAt: now })
      })
    } catch (err) {
      // O pré-check acima não é atômico: duas criações do mesmo endereço ao mesmo tempo passam por ele e uma delas bate
      // na unique do slug (ou do domínio primário) aqui.
      if (isDuplicateEntry(err)) throw new ConflictException(POLO_JA_EXISTE)
      throw err
    }
    this.invalidateCache()
    const criado = await this.getById(id)
    if (!criado) throw tenantNotFound()
    return criado
  }

  async update(id: string, patch: { name?: string; status?: TenantStatus; branding?: TenantBrandingInput }): Promise<TenantContext> {
    const atual = await this.getById(id)
    if (!atual) throw tenantNotFound()
    const set: Partial<typeof tenants.$inferInsert> = { updatedAt: new Date() }
    if (patch.name !== undefined) {
      const name = patch.name.trim()
      if (name.length < 2 || name.length > 160) throw new BadRequestException('Informe o nome do polo (2 a 160 caracteres).')
      set.name = name
    }
    if (patch.status !== undefined) {
      if (atual.isMatriz && patch.status !== 'active') throw new BadRequestException('A matriz não pode ser suspensa.')
      set.status = patch.status
    }
    if (patch.branding !== undefined) set.branding = mergeBranding(atual.branding, patch.branding, id)
    await this.db.update(tenants).set(set).where(eq(tenants.id, id))
    this.invalidateCache()
    const novo = await this.getById(id)
    if (!novo) throw tenantNotFound()
    return novo
  }

  async listDomains(id: string): Promise<Array<{ host: string; isPrimary: boolean }>> {
    const rows = await this.db
      .select({ host: tenantDomains.host, isPrimary: tenantDomains.isPrimary })
      .from(tenantDomains)
      .where(eq(tenantDomains.tenantId, id))
      .orderBy(asc(tenantDomains.host))
    return rows.map((r) => ({ host: r.host, isPrimary: !!r.isPrimary }))
  }

  /** Domínio próprio do polo (a ligação de DNS e certificado é da etapa 3). */
  async addDomain(id: string, rawHost: string): Promise<void> {
    const host = normalizeHost(rawHost)
    const base = this.hostConfig.baseDomain
    // Sem ponto, IP e hosts que a resolução trata de forma especial (run.app, localhost, *.test...) não viram domínio de polo.
    if (!host || !host.includes('.') || isReservedHost(host, this.hostConfig)) throw new BadRequestException('Domínio inválido.')
    if (host === base || host.endsWith(`.${base}`)) {
      throw new BadRequestException('Subdomínios da plataforma são definidos pelo endereço do polo.')
    }
    const existente = await this.db.select().from(tenantDomains).where(eq(tenantDomains.host, host)).limit(1)
    if (existente[0]) throw new ConflictException(DOMINIO_EM_USO)
    try {
      await this.db.insert(tenantDomains).values({ host, tenantId: id, isPrimary: false, createdAt: new Date() })
    } catch (err) {
      // O pré-check acima não é atômico: dois cadastros do mesmo domínio ao mesmo tempo passam por ele e um deles bate na
      // chave primária (o host) aqui.
      if (isDuplicateEntry(err)) throw new ConflictException(DOMINIO_EM_USO)
      throw err
    }
    this.invalidateCache()
  }

  async removeDomain(id: string, rawHost: string): Promise<void> {
    const host = normalizeHost(rawHost)
    if (!host) throw new BadRequestException('Domínio inválido.')
    const rows = await this.db.select().from(tenantDomains).where(eq(tenantDomains.host, host)).limit(1)
    const d = rows[0]
    if (!d || d.tenantId !== id) throw new NotFoundException('Domínio não encontrado neste polo.')
    if (d.isPrimary) throw new BadRequestException('O endereço principal do polo não pode ser removido.')
    await this.db.delete(tenantDomains).where(eq(tenantDomains.host, host))
    this.invalidateCache()
  }
}
