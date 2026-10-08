import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common'
import { asc, count, desc, eq, sql } from 'drizzle-orm'
import { Role } from '@pilari/types'
import type {
  CreateTenantInput, CreateTenantResult, PlatformTenantDetail, PlatformTenantRow, TenantAdminResult, UpdateTenantInput,
} from '@pilari/types'
import { randomPassword } from '../../common/lib/random-password'
import { courses, tenantDomains, tenantMembers, tenants, users } from '../../db/schema'
import type { Database } from '../../db/types'
import { AuthService } from '../auth/auth.service'
import { IdentityService } from '../auth/identity.service'
import { TenantMembersService } from '../tenancy/tenant-members.service'
import { tenantNotFound } from '../tenancy/tenant-errors'
import type { TenantContext } from '../tenancy/tenant-context'
import { TenantsService } from '../tenancy/tenants.service'

type TenantRow = typeof tenants.$inferSelect

@Injectable()
export class PlatformTenantsService {
  private readonly logger = new Logger(PlatformTenantsService.name)

  constructor(
    @Inject('DB_CLIENT') private readonly db: Database,
    private readonly tenants: TenantsService,
    private readonly members: TenantMembersService,
    private readonly identity: IdentityService,
    private readonly auth: AuthService
  ) {}

  async list(): Promise<PlatformTenantRow[]> {
    const rows = (await this.db.select().from(tenants).orderBy(desc(tenants.isMatriz), asc(tenants.name))) as TenantRow[]
    const membros = (await this.db
      .select({
        tenantId: tenantMembers.tenantId,
        admins: sql<string>`SUM(JSON_CONTAINS(${tenantMembers.roles}, '"admin"'))`,
        alunos: sql<string>`SUM(JSON_CONTAINS(${tenantMembers.roles}, '"student"'))`,
      })
      .from(tenantMembers)
      .groupBy(tenantMembers.tenantId)) as Array<{ tenantId: string; admins: string | number | null; alunos: string | number | null }>
    const cursos = (await this.db
      .select({ tenantId: courses.tenantId, status: courses.status, n: count() })
      .from(courses)
      .groupBy(courses.tenantId, courses.status)) as Array<{ tenantId: string; status: string; n: number }>

    return rows.map((r) => {
      const m = membros.find((x) => x.tenantId === r.id)
      const qtd = (status: string) => Number(cursos.find((c) => c.tenantId === r.id && c.status === status)?.n ?? 0)
      return {
        id: r.id,
        slug: r.slug,
        name: r.name,
        status: r.status,
        isMatriz: !!r.isMatriz,
        siteUrl: this.tenants.siteUrl({ slug: r.slug, isMatriz: !!r.isMatriz }),
        adminCount: Number(m?.admins ?? 0),
        studentCount: Number(m?.alunos ?? 0),
        publishedCourseCount: qtd('published'),
        inReviewCount: qtd('in_review'),
        createdAt: r.createdAt ? r.createdAt.toISOString() : null,
      }
    })
  }

  /** O polo, ou 404 TENANT_NOT_FOUND ("Polo não encontrado."), o mesmo corpo do resto da API (B9). */
  async mustGet(id: string): Promise<TenantContext> {
    const t = await this.tenants.getById(id)
    if (!t) throw tenantNotFound()
    return t
  }

  async assertExists(id: string): Promise<void> {
    await this.mustGet(id)
  }

  async detail(id: string): Promise<PlatformTenantDetail> {
    const t = await this.mustGet(id)
    const linha = (await this.list()).find((r) => r.id === id)
    if (!linha) throw tenantNotFound()
    const domains = (await this.tenants.listDomains(id)).map((d) => d.host)
    return { ...linha, branding: t.branding, domains }
  }

  /**
   * Cria o polo e vincula o primeiro admin. Polo sem admin não serve a ninguém, e a nova tentativa daria 409 por um
   * endereço que o operador nunca viu criado: se o vínculo falhar, o polo é desfeito e o erro ORIGINAL sobe. A conta que
   * o `addAdmin` criou nesta chamada já foi desfeita por ele. Depois que o vínculo deu certo nada mais é desfeito, nem
   * se a leitura final falhar: o link de senha já saiu e a conta passou a valer.
   */
  async create(input: CreateTenantInput): Promise<CreateTenantResult> {
    const t = await this.tenants.create({ slug: input.slug, name: input.name, branding: input.branding ?? {} })
    let firstAdmin: TenantAdminResult
    try {
      firstAdmin = await this.addAdmin(t.id, input.firstAdminEmail, input.firstAdminName)
    } catch (err) {
      await this.discardTenant(t.id, t.slug)
      throw err
    }
    return { tenant: await this.detail(t.id), firstAdmin }
  }

  /**
   * Desfaz um polo recém-criado: membros, domínios e o próprio polo, numa transação, e limpa o cache de host (o endereço
   * já pode ter sido servido). Nunca lança: uma falha aqui só é registrada, para não esconder o erro que a provocou.
   */
  private async discardTenant(id: string, slug: string): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        await tx.delete(tenantMembers).where(eq(tenantMembers.tenantId, id))
        await tx.delete(tenantDomains).where(eq(tenantDomains.tenantId, id))
        await tx.delete(tenants).where(eq(tenants.id, id))
      })
    } catch (err) {
      this.logger.error(`Polo ${slug} (${id}) ficou sem admin e NÃO foi desfeito, remova à mão: ${(err as Error).message}`)
    }
    this.tenants.invalidateCache()
  }

  /**
   * Vincula um admin ao polo. E-mail novo vira conta com senha aleatória e recebe o link de definir senha; conta que já
   * existe mas nunca entrou recebe o link de novo (B11).
   */
  async addAdmin(tenantId: string, rawEmail: string, rawName: string): Promise<TenantAdminResult> {
    await this.assertExists(tenantId)
    const email = rawEmail.trim().toLowerCase()
    const name = rawName.trim()
    const existente = await this.identity.findUidByEmail(email)
    // Senha que ninguém conhece: o titular define a dele pelo link de redefinição.
    const uid = existente ?? (await this.identity.createIdentity(email, name, randomPassword()))
    try {
      await this.auth.ensureUserRow({ uid, email, displayName: name })
      const atuais = (await this.members.rolesOf(tenantId, uid)) ?? []
      await this.members.setRoles(tenantId, uid, [...new Set<Role>([...atuais, Role.admin])])
    } catch (err) {
      // A conta é desta chamada e o vínculo não saiu: desfaz a conta. Se ficasse, a nova tentativa a acharia "já existente"
      // e o link de senha nunca sairia. Conta que já existia nunca é apagada.
      if (existente === null) await this.discardNewAccount(uid)
      throw err
    }
    let resetEmailSent = false
    // Conta nova, ou que já existia mas nunca entrou (o link da primeira vez se perdeu ou venceu, B11): manda o link de
    // definir senha. Quem já entrou segue com a senha dele, sem link.
    if (!existente || (await this.neverSignedIn(uid))) {
      try {
        await this.identity.sendPasswordResetEmail(email)
        resetEmailSent = true
      } catch (err) {
        // O vínculo fica; a tela avisa e a plataforma reenvia pela lista de usuários do polo.
        // O log leva o uid, não o e-mail: o IdentityService também evita e-mail (PII) nos logs.
        this.logger.warn(`Link de senha não enviado ao novo admin ${uid} do polo ${tenantId}: ${(err as Error).message}`)
      }
    }
    return { uid, email, existingAccount: existente !== null, resetEmailSent }
  }

  /** A conta nunca entrou? Na dúvida (o Firebase não respondeu), não: sem link, e fica registrado com o uid (sem e-mail). */
  private async neverSignedIn(uid: string): Promise<boolean> {
    try {
      return !(await this.identity.hasSignedIn(uid))
    } catch (err) {
      this.logger.warn(`Não deu para saber se a conta ${uid} já entrou; o link de senha não foi reenviado: ${(err as Error).message}`)
      return false
    }
  }

  /**
   * Desfaz a conta que ESTA chamada criou: o Firebase, os vínculos e o cadastro espelhado (que só existem se a chamada os
   * criou, porque o uid é novo). O vínculo pode ter sido gravado antes da falha: se ficasse, seria um admin fantasma que
   * conta no anti-lockout e na lista do console (B9). Nunca lança, e cada etapa é independente: uma falha é registrada,
   * com o uid e sem o e-mail (PII), e não esconde o erro que a provocou.
   */
  private async discardNewAccount(uid: string): Promise<void> {
    try {
      await this.identity.deleteIdentity(uid)
    } catch (err) {
      this.logger.error(`Conta ${uid}, criada para o novo admin, NÃO foi apagada do Firebase, apague à mão: ${(err as Error).message}`)
    }
    try {
      await this.db.delete(tenantMembers).where(eq(tenantMembers.userUid, uid))
    } catch (err) {
      this.logger.error(`Vínculos da conta ${uid}, criada para o novo admin, NÃO foram apagados, apague à mão: ${(err as Error).message}`)
    }
    try {
      await this.db.delete(users).where(eq(users.uid, uid))
    } catch (err) {
      this.logger.error(`Cadastro ${uid}, criado para o novo admin, NÃO foi apagado, apague à mão: ${(err as Error).message}`)
    }
  }

  async update(id: string, patch: UpdateTenantInput): Promise<PlatformTenantDetail> {
    // Corpo vazio não é edição: sem isto a auditoria registraria "Alterou o polo X:" sem nada alterado (B9).
    if (patch.name === undefined && patch.status === undefined && patch.branding === undefined) {
      throw new BadRequestException('Nada para alterar.')
    }
    await this.tenants.update(id, patch)
    return this.detail(id)
  }

  async addDomain(id: string, host: string): Promise<PlatformTenantDetail> {
    await this.assertExists(id)
    await this.tenants.addDomain(id, host)
    return this.detail(id)
  }

  async removeDomain(id: string, host: string): Promise<PlatformTenantDetail> {
    await this.assertExists(id)
    await this.tenants.removeDomain(id, host)
    return this.detail(id)
  }
}
