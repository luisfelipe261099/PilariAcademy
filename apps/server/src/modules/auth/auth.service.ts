import { BadRequestException, ConflictException, ForbiddenException, Injectable, Inject, NotFoundException } from '@nestjs/common'
import { and, asc, count, eq, like, or, sql, type SQL } from 'drizzle-orm'
import { alias, type MySqlUpdateSetSource } from 'drizzle-orm/mysql-core'
import { type AdminUpdateUserInput, type AdminUserDetail, type AuthUser, Role } from '@pilari/types'
import { tenantMembers, users } from '../../db/schema'
import type { Database } from '../../db/types'
import type { Actor } from '../../common/types/actor.type'
import { isEffectivePlatformAdmin } from '../../common/lib/effective-roles'
import { platformAccountForbidden, TenantMembersService } from '../tenancy/tenant-members.service'
import { MATRIZ_TENANT_ID } from '../tenancy/tenancy.constants'
import { toAdminUserDetail, toAuthUser } from './to-auth-user'
import { isValidCpf, onlyDigits } from '../../common/cpf'

type UserRow = typeof users.$inferSelect

/** O vínculo da matriz de cada membro listado, para o isPlatformAdmin efetivo (B10) sair na mesma consulta. */
const vinculoNaMatriz = alias(tenantMembers, 'tm_matriz')

/** Monta o filtro de busca por nome OU e-mail (LIKE, com escape de curingas). */
function userSearchCondition(q?: string): SQL | undefined {
  const term = q?.trim()
  if (!term) return undefined
  const pattern = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  return or(like(users.email, pattern), like(users.displayName, pattern))
}

/**
 * Valor de SET que só preenche a coluna vazia (null, vazio ou só espaços), decidido pelo MySQL na linha atual: nunca
 * regrava um valor lido antes do UPDATE.
 */
function preencheSeVazio(coluna: typeof users.displayName | typeof users.photoUrl, valor: string | null): SQL {
  return sql`CASE WHEN COALESCE(TRIM(${coluna}), '') = '' THEN ${valor} ELSE ${coluna} END`
}

type UpsertUserInput = {
  uid: string
  email: string
  displayName?: string
  photoUrl?: string
  roles?: Role[]
  disabled?: boolean
}

/**
 * Persistência do usuário espelhado (identidade global) e a administração dos usuários DE UM
 * POLO. Os papéis valem por polo e moram em `tenant_members`; a coluna `users.roles` não é mais
 * lida para autorizar nada.
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject('DB_CLIENT') private readonly db: Database,
    private readonly members: TenantMembersService
  ) {}

  /**
   * Cria ou atualiza o usuário espelhado (o login chama a cada sessão).
   * - Usuário novo sem roles entra como `['student']` (default do EAD).
   * - No update, não sobrescreve as roles existentes com um array vazio.
   * - Nome e foto só são gravados quando o cadastro está vazio (B1): o nome vai impresso no certificado e pode ter sido
   *   corrigido pelo Studio Pilari ou pelo polo; o do Google ou o que o client mandar nunca passa por cima dele.
   *
   * O update nunca regrava um valor lido antes: o que já está preenchido é decidido pelo próprio UPDATE, na linha atual
   * (CASE), e o que não veio no pedido fica fora do SET. Senão, uma correção de nome (ou a desativação da conta) gravada
   * entre a leitura e a gravação seria desfeita pelo login.
   */
  async upsertUser(input: UpsertUserInput) {
    const now = new Date()
    const existing = await this.db.select().from(users).where(eq(users.uid, input.uid)).limit(1)

    if (existing.length === 0) {
      await this.db.insert(users).values({
        uid: input.uid,
        email: input.email,
        displayName: input.displayName || null,
        photoUrl: input.photoUrl || null,
        roles: input.roles && input.roles.length > 0 ? input.roles : [Role.student],
        disabled: input.disabled ?? false,
        createdAt: now,
        updatedAt: now,
      })
    } else {
      const set: MySqlUpdateSetSource<typeof users> = {
        email: input.email,
        displayName: preencheSeVazio(users.displayName, input.displayName || null),
        photoUrl: preencheSeVazio(users.photoUrl, input.photoUrl || null),
        updatedAt: now,
      }
      if (input.roles && input.roles.length > 0) set.roles = input.roles
      if (input.disabled !== undefined) set.disabled = input.disabled
      await this.db.update(users).set(set).where(eq(users.uid, input.uid))
    }

    const updated = await this.db.select().from(users).where(eq(users.uid, input.uid)).limit(1)
    return updated[0]
  }

  async getUserByUid(uid: string) {
    const rows = await this.db.select().from(users).where(eq(users.uid, uid)).limit(1)
    return rows[0] || null
  }

  /**
   * Atualiza o próprio perfil (nome, foto, qualificação, bio, CPF). Só os campos informados.
   *
   * Pessoa compartilhada (relações reais, CA-6, em dois polos ou mais: matrícula, certificado ou papel de equipe) não
   * TROCA nome nem CPF já preenchidos (B8, 403 SHARED_USER_PLATFORM_ONLY): eles vão para documentos de mais de um polo, e
   * quem corrige é o Studio Pilari. O endereço de onde ela edita não muda a regra. Preencher o que está vazio continua livre, e
   * reenviar o mesmo valor não é troca (a tela do instrutor manda o nome junto com a bio). O próprio Studio Pilari não é
   * barrada.
   */
  async updateProfile(
    quem: { tenantId: string; isPlatformAdmin: boolean },
    uid: string,
    dto: { displayName?: string; photoUrl?: string; headline?: string; bio?: string; cpf?: string }
  ) {
    const existing = await this.db.select().from(users).where(eq(users.uid, uid)).limit(1)
    if (existing.length === 0) throw new NotFoundException('Usuário não encontrado.')
    const nomeAtual = (existing[0].displayName ?? '').trim()
    const cpfAtual = onlyDigits(existing[0].cpf)
    const cpfNovo = dto.cpf !== undefined ? onlyDigits(dto.cpf) : ''
    const trocaNome = dto.displayName !== undefined && nomeAtual !== '' && (dto.displayName ?? '').trim() !== nomeAtual
    const trocaCpf = cpfAtual !== '' && cpfNovo !== '' && cpfNovo !== cpfAtual
    if ((trocaNome || trocaCpf) && !quem.isPlatformAdmin && (await this.members.isSharedPerson(uid))) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'SHARED_USER_PLATFORM_ONLY',
        message: 'Seu nome e CPF vão para certificados de mais de um polo. Para corrigir, fale com o Studio Pilari.',
      })
    }
    const patch: Record<string, string | null> = {}
    // CPF é WRITE-ONCE. Ele vai impresso no certificado (congelado no snapshot da emissão) e
    // é o documento do cadastro no Asaas: deixar o aluno reescrever permitiria emitir um
    // documento com o CPF de outra pessoa, e não corrigiria os que já saíram. Vazio → grava;
    // preenchido → ignora em silêncio (a tela nem oferece o campo).
    if (dto.cpf !== undefined && !cpfAtual && cpfNovo.length === 11) patch.cpf = cpfNovo
    // O mesmo nome reenviado não é gravado de novo.
    if (dto.displayName !== undefined && (dto.displayName ?? '').trim() !== nomeAtual) patch.displayName = dto.displayName || null
    if (dto.photoUrl !== undefined) patch.photoUrl = dto.photoUrl || null
    if (dto.headline !== undefined) patch.headline = dto.headline || null
    if (dto.bio !== undefined) patch.bio = dto.bio || null
    await this.db.update(users).set({ ...patch, updatedAt: new Date() }).where(eq(users.uid, uid))
    const updated = await this.db.select().from(users).where(eq(users.uid, uid)).limit(1)
    return updated[0]
  }

  /**
   * Membros do polo, com os papéis NO POLO, e o `total` do filtro aplicado. Sem `page`/`pageSize`
   * devolve todos (dropdowns e telas que precisam da lista inteira); com eles, pagina
   * (LIMIT/OFFSET) ordenando por e-mail.
   */
  async listMembers(tenantId: string, opts: { page?: number; pageSize?: number; q?: string } = {}): Promise<{ users: AuthUser[]; total: number }> {
    const cond = and(eq(tenantMembers.tenantId, tenantId), userSearchCondition(opts.q))
    const totalRows = await this.db
      .select({ n: count() })
      .from(users)
      .innerJoin(tenantMembers, eq(tenantMembers.userUid, users.uid))
      .where(cond)
    const total = Number(totalRows[0]?.n ?? 0)
    const base = this.db
      .select({ user: users, roles: tenantMembers.roles, matrizRoles: vinculoNaMatriz.roles })
      .from(users)
      .innerJoin(tenantMembers, eq(tenantMembers.userUid, users.uid))
      .leftJoin(vinculoNaMatriz, and(eq(vinculoNaMatriz.userUid, users.uid), eq(vinculoNaMatriz.tenantId, MATRIZ_TENANT_ID)))
      .where(cond)
      .orderBy(asc(users.email))
    const rows = opts.page && opts.pageSize ? await base.limit(opts.pageSize).offset((opts.page - 1) * opts.pageSize) : await base
    return {
      users: rows.map((r) => toAuthUser(r.user, (r.roles ?? []) as Role[], isEffectivePlatformAdmin(r.user.isPlatformAdmin, r.matrizRoles))),
      total,
    }
  }

  /**
   * Perfil completo (com CPF e status) de um membro do polo. 404 para quem não é do polo. O CPF inteiro só vai para a
   * plataforma ou para o polo que tem a pessoa só para si: de quem tem qualquer vínculo com outro polo (até o vínculo
   * passivo que o login cria, definição ampla de `isLinkedOutside`), o polo vê a máscara do documento público (B2).
   * Vincular alguém pelo e-mail não dá acesso ao documento dela.
   */
  async getMemberDetail(quem: { tenantId: string; isPlatformAdmin: boolean }, uid: string): Promise<AdminUserDetail> {
    const papeis = await this.members.rolesOf(quem.tenantId, uid)
    const row = papeis ? await this.getUserByUid(uid) : null
    if (!papeis || !row) throw new NotFoundException('Usuário não encontrado neste polo.')
    const mascarar = !quem.isPlatformAdmin && onlyDigits(row.cpf) !== '' && (await this.members.isLinkedOutside(quem.tenantId, uid))
    return toAdminUserDetail(row, papeis, await this.platformFlagOf(row, quem.tenantId, papeis), { maskCpf: mascarar })
  }

  /**
   * Admin da plataforma efetivo (B10) de um cadastro já lido: o sinal dele ou o admin no vínculo da matriz. No endereço da
   * matriz, o vínculo em mãos (`papeisAqui`) é o da matriz; fora dela, ele é lido, salvo quando o sinal já decide.
   */
  private async platformFlagOf(row: UserRow, tenantId: string, papeisAqui: Role[] | null): Promise<boolean> {
    if (row.isPlatformAdmin) return true
    const daMatriz = tenantId === MATRIZ_TENANT_ID ? papeisAqui : await this.members.rolesOf(MATRIZ_TENANT_ID, row.uid)
    return isEffectivePlatformAdmin(row.isPlatformAdmin, daMatriz)
  }

  /** Cria o usuário espelhado se ainda não existir. Nunca altera um cadastro existente. */
  async ensureUserRow(input: { uid: string; email: string; displayName: string }) {
    const existente = await this.getUserByUid(input.uid)
    if (existente) return existente
    return this.upsertUser({ uid: input.uid, email: input.email, displayName: input.displayName })
  }

  /**
   * Edição do perfil do aluno PELO ADMIN (nome e CPF). Diferente de `updateProfile`, aqui o
   * CPF pode ser corrigido mesmo já preenchido: o aluno não pode reescrever o próprio
   * documento, mas a instituição corrige cadastro errado — e a alteração fica auditada no
   * controller. Certificados já emitidos não mudam sozinhos (o snapshot deles é congelado).
   * Só vale para membro do polo do ator; quem não é do polo responde 404. Quem não é da plataforma não edita conta da
   * plataforma (403 PLATFORM_ACCOUNT, B4) nem pessoa compartilhada (403 SHARED_USER_PLATFORM_ONLY).
   */
  async adminUpdateUser(actor: Actor, uid: string, dto: AdminUpdateUserInput): Promise<AdminUserDetail> {
    const papeis = await this.members.rolesOf(actor.tenantId, uid)
    if (!papeis) throw new NotFoundException('Usuário não encontrado neste polo.')
    const existing = await this.db.select().from(users).where(eq(users.uid, uid)).limit(1)
    if (existing.length === 0) throw new NotFoundException('Usuário não encontrado.')
    const daPlataforma = await this.platformFlagOf(existing[0], actor.tenantId, papeis)
    if (!actor.isPlatformAdmin && daPlataforma) throw platformAccountForbidden()
    // Nome e CPF vão para os certificados de TODOS os polos da pessoa. Pessoa compartilhada (matrícula, certificado ou
    // papel de equipe em outro polo) só é corrigida pelo Studio Pilari, para um polo não alterar documento de outro.
    if (!actor.isPlatformAdmin && (await this.members.isSharedOutside(actor.tenantId, uid))) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'SHARED_USER_PLATFORM_ONLY',
        message: 'Esta pessoa também está ligada a outro polo da rede. Nome e CPF vão para os certificados de todos os polos dela; quem corrige é o Studio Pilari.',
      })
    }
    const patch: Record<string, string | null> = {}
    if (dto.displayName !== undefined) {
      const nome = dto.displayName.trim().replace(/\s+/g, ' ')
      if (nome.length < 3 || nome.includes('@')) {
        throw new BadRequestException('Informe o nome completo do aluno (sem e-mail).')
      }
      patch.displayName = nome
    }
    if (dto.cpf !== undefined) {
      if (!isValidCpf(dto.cpf)) throw new BadRequestException('CPF inválido.')
      patch.cpf = onlyDigits(dto.cpf)
    }
    if (Object.keys(patch).length === 0) throw new BadRequestException('Nada para alterar.')
    await this.db.update(users).set({ ...patch, updatedAt: new Date() }).where(eq(users.uid, uid))
    const updated = await this.db.select().from(users).where(eq(users.uid, uid)).limit(1)
    return toAdminUserDetail(updated[0], papeis, daPlataforma)
  }

  /**
   * Papéis do usuário NESTE polo (404 se não é do polo). Regra anti-lockout: um admin só deixa de ser admin se sobrar
   * outro. Nos polos, quem é da plataforma age como admin em todos, então não é barrado. Na MATRIZ vale para todo mundo,
   * a plataforma inclusive: o admin da matriz é o admin da plataforma pela tela (B10), e o último não sai (409). Os
   * papéis moram no vínculo: a troca vale na próxima requisição, sem claims e sem revogar sessão.
   */
  async setTenantRoles(actor: Actor, uid: string, roles: Role[]): Promise<AuthUser> {
    const atuais = await this.members.rolesOf(actor.tenantId, uid)
    const row = atuais ? await this.getUserByUid(uid) : null
    if (!atuais || !row) throw new NotFoundException('Usuário não encontrado neste polo.')
    // Conta da equipe do Studio Pilari: o polo não troca os papéis dela (B4).
    const eraDaPlataforma = await this.platformFlagOf(row, actor.tenantId, atuais)
    if (!actor.isPlatformAdmin && eraDaPlataforma) throw platformAccountForbidden()
    const perdeAdmin = atuais.includes(Role.admin) && !roles.includes(Role.admin)
    const naMatriz = actor.tenantId === MATRIZ_TENANT_ID
    if (perdeAdmin && (naMatriz || !actor.isPlatformAdmin)) {
      // Conferir e gravar numa transação com os vínculos travados: duas trocas simultâneas não passam as duas pela
      // contagem (na matriz, a rede ficaria sem admin da plataforma).
      if (!(await this.members.setRolesKeepingAnAdmin(actor.tenantId, uid, roles))) {
        if (naMatriz) {
          throw new ConflictException({
            statusCode: 409,
            code: 'LAST_ADMIN',
            message: 'A matriz precisa de ao menos um admin. Dê o papel de admin a outra pessoa antes de tirar o desta.',
          })
        }
        throw new BadRequestException('O polo precisa de ao menos um admin.')
      }
    } else {
      await this.members.setRoles(actor.tenantId, uid, roles)
    }
    // Fora da matriz o vínculo da matriz não mudou; na matriz, os papéis novos decidem.
    return toAuthUser(row, roles, naMatriz ? isEffectivePlatformAdmin(row.isPlatformAdmin, roles) : eraDaPlataforma)
  }
}
