import { ForbiddenException, Inject, Injectable } from '@nestjs/common'
import { and, count, eq, inArray, ne, or, sql } from 'drizzle-orm'
import { Role } from '@pilari/types'
import { isEffectivePlatformAdmin } from '../../common/lib/effective-roles'
import { certificates, courses, enrollments, tenantMembers, users } from '../../db/schema'
import type { Database } from '../../db/types'
import { MATRIZ_TENANT_ID } from './tenancy.constants'

const PAPEIS_VALIDOS = new Set<string>([Role.admin, Role.teacher, Role.student])

const papeisValidos = (roles: unknown): Role[] => ((roles ?? []) as string[]).filter((r) => PAPEIS_VALIDOS.has(r)) as Role[]

/**
 * Conta da equipe do Studio Pilari (admin da plataforma efetivo): o polo não a vincula, edita, troca papéis, redefine a senha
 * nem dá cortesia a ela (B4). Só a própria plataforma mexe nela.
 */
export function platformAccountForbidden(): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    code: 'PLATFORM_ACCOUNT',
    message: 'Esta conta é da equipe do Studio Pilari e não pode ser alterada pelo polo.',
  })
}

/** Vínculo usuário-polo. Os papéis valem só dentro do polo; identidade (users) é global. */
@Injectable()
export class TenantMembersService {
  constructor(@Inject('DB_CLIENT') private readonly db: Database) {}

  /** Papéis do usuário no polo. null = sem vínculo. */
  async rolesOf(tenantId: string, uid: string): Promise<Role[] | null> {
    const rows = await this.db
      .select({ roles: tenantMembers.roles })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userUid, uid)))
      .limit(1)
    if (!rows[0]) return null
    return papeisValidos(rows[0].roles)
  }

  /**
   * Papéis no polo do endereço e na matriz, numa consulta só: o guard precisa dos dois a cada requisição, porque o admin
   * da matriz é admin da plataforma em qualquer polo (B10). null = sem vínculo. No endereço da matriz os dois são o mesmo
   * vínculo; sem polo na requisição, só a matriz é lida.
   */
  async rolesHereAndInMatriz(tenantId: string | undefined, uid: string): Promise<{ roles: Role[] | null; matrizRoles: Role[] | null }> {
    const ids = [...new Set([tenantId, MATRIZ_TENANT_ID].filter((id): id is string => !!id))]
    const rows = (await this.db
      .select({ tenantId: tenantMembers.tenantId, roles: tenantMembers.roles })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.userUid, uid), inArray(tenantMembers.tenantId, ids)))) as Array<{ tenantId: string; roles: unknown }>
    const de = (id: string | undefined): Role[] | null => {
      const linha = id ? rows.find((r) => r.tenantId === id) : undefined
      return linha ? papeisValidos(linha.roles) : null
    }
    return { roles: de(tenantId), matrizRoles: de(MATRIZ_TENANT_ID) }
  }

  /**
   * Admin da plataforma EFETIVO de qualquer pessoa (não de quem está logado: esse vem do guard), numa consulta só: o
   * sinal do cadastro ou o admin no vínculo da matriz. Sem cadastro, não é.
   */
  async isPlatformAdmin(uid: string): Promise<boolean> {
    const rows = (await this.db
      .select({ flag: users.isPlatformAdmin, matrizRoles: tenantMembers.roles })
      .from(users)
      .leftJoin(tenantMembers, and(eq(tenantMembers.userUid, users.uid), eq(tenantMembers.tenantId, MATRIZ_TENANT_ID)))
      .where(eq(users.uid, uid))
      .limit(1)) as Array<{ flag: boolean | null; matrizRoles: string[] | null }>
    const r = rows[0]
    return !!r && isEffectivePlatformAdmin(r.flag, r.matrizRoles)
  }

  /** 403 PLATFORM_ACCOUNT quando quem age não é da plataforma e a conta alvo é (B4). A plataforma nem consulta. */
  async assertNotPlatformAccount(actorIsPlatformAdmin: boolean, uid: string): Promise<void> {
    if (!actorIsPlatformAdmin && (await this.isPlatformAdmin(uid))) throw platformAccountForbidden()
  }

  /** Garante o vínculo de aluno. Quem já é membro mantém os papéis que tem. */
  async ensureStudent(tenantId: string, uid: string): Promise<void> {
    const now = new Date()
    await this.db
      .insert(tenantMembers)
      .values({ tenantId, userUid: uid, roles: [Role.student], createdAt: now, updatedAt: now })
      .onDuplicateKeyUpdate({ set: { tenantId: sql`tenant_id` } })
  }

  /**
   * Vínculo de aluno de quem comprou (B3): o mesmo `ensureStudent` da cortesia, nunca para admin da plataforma (ela já
   * age como admin em todo polo e não vira aluna dos polos onde compra).
   */
  async ensureStudentUnlessPlatform(tenantId: string, uid: string): Promise<void> {
    if (await this.isPlatformAdmin(uid)) return
    await this.ensureStudent(tenantId, uid)
  }

  /** Define os papéis do usuário no polo, criando o vínculo se faltar. */
  async setRoles(tenantId: string, uid: string, roles: Role[]): Promise<void> {
    await this.gravarPapeis(this.db, tenantId, uid, roles)
  }

  /**
   * Troca os papéis sem deixar o polo sem admin explícito (regra anti-lockout). A contagem e a gravação são uma transação
   * só, com os vínculos do polo travados (`FOR UPDATE`): dois admins tirando o papel um do outro ao mesmo tempo passam
   * um de cada vez, e o segundo já vê o primeiro. Devolve `false`, sem gravar, quando ninguém mais seria admin.
   */
  async setRolesKeepingAnAdmin(tenantId: string, uid: string, roles: Role[]): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const admins = await tx
        .select({ uid: tenantMembers.userUid })
        .from(tenantMembers)
        .where(and(eq(tenantMembers.tenantId, tenantId), sql`JSON_CONTAINS(${tenantMembers.roles}, '"admin"')`))
        .for('update')
      if (!roles.includes(Role.admin) && !admins.some((a) => a.uid !== uid)) return false
      await this.gravarPapeis(tx, tenantId, uid, roles)
      return true
    })
  }

  private async gravarPapeis(db: Pick<Database, 'insert'>, tenantId: string, uid: string, roles: Role[]): Promise<void> {
    const now = new Date()
    await db
      .insert(tenantMembers)
      .values({ tenantId, userUid: uid, roles, createdAt: now, updatedAt: now })
      .onDuplicateKeyUpdate({ set: { roles, updatedAt: now } })
  }

  async isMember(tenantId: string, uid: string): Promise<boolean> {
    return (await this.rolesOf(tenantId, uid)) !== null
  }

  /**
   * Pessoa COMPARTILHADA, vista do polo `tenantId` (CA-6): tem, em OUTRO polo, ao menos um papel de equipe (professor ou
   * admin), uma matrícula (em qualquer situação) ou um certificado. Nome e CPF dela vão para documentos de outro polo,
   * então só o Studio Pilari corrige; e o polo daqui não ganha poder sobre ela (senha, CPF inteiro) só por tê-la vinculado.
   * O vínculo de aluno que o login cria ao visitar o site de outro polo NÃO conta. Três consultas curtas, na ordem da
   * mais barata, e para na primeira que achar.
   */
  async isSharedOutside(tenantId: string, uid: string): Promise<boolean> {
    const equipe = await this.db
      .select({ tenantId: tenantMembers.tenantId })
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.userUid, uid),
          ne(tenantMembers.tenantId, tenantId),
          or(sql`JSON_CONTAINS(${tenantMembers.roles}, '"admin"')`, sql`JSON_CONTAINS(${tenantMembers.roles}, '"teacher"')`)
        )
      )
      .limit(1)
    if (equipe[0]) return true
    const matricula = await this.db
      .select({ id: enrollments.id })
      .from(enrollments)
      .innerJoin(courses, eq(courses.id, enrollments.courseId))
      .where(and(eq(enrollments.userId, uid), ne(courses.tenantId, tenantId)))
      .limit(1)
    if (matricula[0]) return true
    const certificado = await this.db
      .select({ id: certificates.id })
      .from(certificates)
      .innerJoin(courses, eq(courses.id, certificates.courseId))
      .where(and(eq(certificates.userId, uid), ne(courses.tenantId, tenantId)))
      .limit(1)
    return !!certificado[0]
  }

  /**
   * Qualquer ligação fora do polo `tenantId` (definição AMPLA): um vínculo com outro polo, até o vínculo passivo de aluno
   * que o login cria ao visitar o site de outro polo (a matriz inclusive), ou a relação real do CA-6. Vale para o que
   * expõe a pessoa à rede inteira a partir de um polo: o CPF inteiro e a redefinição da senha (que derruba as sessões em
   * todos os polos). O polo que vincula pelo e-mail uma conta que só visitou outro site não ganha o documento nem a senha
   * dela. Corrigir nome e CPF continua com a definição estrita (`isSharedOutside`).
   */
  async isLinkedOutside(tenantId: string, uid: string): Promise<boolean> {
    const vinculo = await this.db
      .select({ tenantId: tenantMembers.tenantId })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.userUid, uid), ne(tenantMembers.tenantId, tenantId)))
      .limit(1)
    if (vinculo[0]) return true
    // Matrícula ou certificado fora sem vínculo (dado anterior aos vínculos) também conta.
    return this.isSharedOutside(tenantId, uid)
  }

  /**
   * Pessoa compartilhada pela regra do PRÓPRIO perfil: relações reais (CA-6: papel de equipe, matrícula em qualquer
   * situação ou certificado) em dois polos ou mais, seja qual for o endereço de onde ela edita. O endereço não decide: a
   * aluna só do polo A que abre o site da matriz continua sendo de um polo só. Para ao achar o segundo polo.
   */
  async isSharedPerson(uid: string): Promise<boolean> {
    const polos = new Set<string>()
    const equipe = (await this.db
      .select({ tenantId: tenantMembers.tenantId })
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.userUid, uid),
          or(sql`JSON_CONTAINS(${tenantMembers.roles}, '"admin"')`, sql`JSON_CONTAINS(${tenantMembers.roles}, '"teacher"')`)
        )
      )) as Array<{ tenantId: string }>
    for (const r of equipe) polos.add(r.tenantId)
    if (polos.size >= 2) return true
    const matriculas = (await this.db
      .select({ tenantId: courses.tenantId })
      .from(enrollments)
      .innerJoin(courses, eq(courses.id, enrollments.courseId))
      .where(eq(enrollments.userId, uid))
      .groupBy(courses.tenantId)) as Array<{ tenantId: string }>
    for (const r of matriculas) polos.add(r.tenantId)
    if (polos.size >= 2) return true
    const certificados = (await this.db
      .select({ tenantId: courses.tenantId })
      .from(certificates)
      .innerJoin(courses, eq(courses.id, certificates.courseId))
      .where(eq(certificates.userId, uid))
      .groupBy(courses.tenantId)) as Array<{ tenantId: string }>
    for (const r of certificados) polos.add(r.tenantId)
    return polos.size >= 2
  }

  /** Admins explícitos do polo, opcionalmente sem contar um usuário (regra anti-lockout). */
  async countAdmins(tenantId: string, exceptUid?: string): Promise<number> {
    const conds = [eq(tenantMembers.tenantId, tenantId), sql`JSON_CONTAINS(${tenantMembers.roles}, '"admin"')`]
    if (exceptUid) conds.push(ne(tenantMembers.userUid, exceptUid))
    const rows = await this.db.select({ n: count() }).from(tenantMembers).where(and(...conds))
    return Number(rows[0]?.n ?? 0)
  }
}
