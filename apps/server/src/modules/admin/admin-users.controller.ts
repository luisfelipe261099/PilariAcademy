import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { DecodedFirebaseUser } from '../../common/types/user.type'
import { actorOf } from '../../common/types/actor.type'
import { type AdminEnrollment, type AdminUserDetail, type AuthUser, Role } from '@pilari/types'
import { AuthService } from '../auth/auth.service'
import { IdentityService } from '../auth/identity.service'
import { toAuthUser } from '../auth/to-auth-user'
import { AuditService } from '../audit/audit.service'
import { CurrentTenant } from '../tenancy/current-tenant.decorator'
import type { TenantContext } from '../tenancy/tenant-context'
import { TenantMembersService } from '../tenancy/tenant-members.service'
import { tenantSuspendedForEnrollment } from '../tenancy/tenant-errors'
import { AdminService } from './admin.service'
import { CreateUserDto } from './dto/create-user.dto'
import { UpdateUserDto } from './dto/update-user.dto'
import { ListUsersDto } from './dto/list-users.dto'
import { SetRolesDto } from './dto/set-roles.dto'
import { GrantEnrollmentDto } from './dto/grant-enrollment.dto'

/** Usuários DO POLO do endereço: lista, perfil, papéis, cortesia. Quem não é do polo responde 404. */
@Controller('admin/users')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(Role.admin)
export class AdminUsersController {
  constructor(
    private readonly authService: AuthService,
    private readonly identityService: IdentityService,
    private readonly admin: AdminService,
    private readonly audit: AuditService,
    private readonly members: TenantMembersService
  ) {}

  @Get()
  async list(@CurrentTenant() tenant: TenantContext, @Query() dto: ListUsersDto): Promise<{ users: AuthUser[]; total: number }> {
    return this.authService.listMembers(tenant.id, { page: dto.page, pageSize: dto.pageSize, q: dto.q })
  }

  /** Cria ou vincula. Se a pessoa já tem conta na rede, só ganha os papéis NESTE polo e mantém a senha dela. */
  @Post()
  async create(@CurrentUser() current: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Body() dto: CreateUserDto): Promise<{ user: AuthUser; existingAccount: boolean }> {
    const email = dto.email.trim().toLowerCase()
    let uid = await this.identityService.findUidByEmail(email)
    const existingAccount = uid !== null
    // Conta da equipe do Studio Pilari não ganha vínculo pelo polo (B4).
    if (uid) await this.members.assertNotPlatformAccount(actorOf(current, tenant).isPlatformAdmin, uid)
    if (uid && (await this.members.isMember(tenant.id, uid))) {
      throw new ConflictException('Esta pessoa já faz parte do polo. Altere os papéis na lista de usuários.')
    }
    if (!uid) uid = await this.identityService.createIdentity(email, dto.displayName, dto.password)
    const row = await this.authService.ensureUserRow({ uid, email, displayName: dto.displayName })
    await this.members.setRoles(tenant.id, uid, dto.roles)
    // Lido depois do vínculo: dar admin na matriz já faz da pessoa alguém da plataforma (B10).
    const isPlatformAdmin = await this.members.isPlatformAdmin(uid)
    this.audit.log({
      tenantId: tenant.id,
      actorUid: current.uid,
      actorEmail: current.email,
      action: 'user.create',
      summary: `${existingAccount ? 'Vinculou' : 'Criou'} ${email} com papéis ${dto.roles.join(', ')}`,
      targetType: 'user',
      targetId: uid,
    })
    return { user: toAuthUser(row, dto.roles, isPlatformAdmin), existingAccount }
  }

  /** Perfil completo do aluno (com CPF e status) para a tela de detalhe. CPF de pessoa compartilhada sai mascarado para o polo. */
  @Get(':uid')
  async detail(@CurrentUser() current: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('uid') uid: string): Promise<{ user: AdminUserDetail }> {
    return { user: await this.authService.getMemberDetail(actorOf(current, tenant), uid) }
  }

  /**
   * Edição de nome e CPF pelo admin. Auditado sempre, com o CPF fora do resumo: o log é
   * lido por outros admins e guardado em backup, e o documento em si não precisa estar lá.
   * Pessoa compartilhada (matrícula, certificado ou papel de equipe em outro polo) só é corrigida pela plataforma
   * (403 SHARED_USER_PLATFORM_ONLY).
   */
  @Patch(':uid')
  async update(@CurrentUser() current: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('uid') uid: string, @Body() dto: UpdateUserDto): Promise<{ user: AdminUserDetail }> {
    const user = await this.authService.adminUpdateUser(actorOf(current, tenant), uid, dto)
    const campos = [dto.displayName !== undefined ? `nome → "${user.displayName ?? ''}"` : null, dto.cpf !== undefined ? 'CPF' : null].filter(Boolean)
    this.audit.log({ tenantId: tenant.id, actorUid: current.uid, actorEmail: current.email, action: 'user.profile-admin', summary: `Alterou o perfil de ${user.email}: ${campos.join(', ')}`, targetType: 'user', targetId: uid })
    return { user }
  }

  @Patch(':uid/roles')
  async setRoles(
    @CurrentUser() current: DecodedFirebaseUser,
    @CurrentTenant() tenant: TenantContext,
    @Param('uid') uid: string,
    @Body() dto: SetRolesDto
  ): Promise<{ user: AuthUser }> {
    // Anti-lockout: o admin não pode remover o próprio papel admin.
    if (current.uid === uid && !dto.roles.includes(Role.admin)) {
      throw new BadRequestException('Você não pode remover seu próprio papel de admin.')
    }
    // Os papéis moram em tenant_members e o banco é lido a cada requisição: a troca vale na
    // próxima chamada, sem claims no token e sem revogar a sessão da pessoa.
    const user = await this.authService.setTenantRoles(actorOf(current, tenant), uid, dto.roles)
    this.audit.log({ tenantId: tenant.id, actorUid: current.uid, actorEmail: current.email, action: 'user.roles', summary: `Alterou papéis de ${user.email} para ${dto.roles.join(', ')}`, targetType: 'user', targetId: uid })
    return { user }
  }

  @Post(':uid/password-reset')
  async sendPasswordReset(@CurrentUser() current: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('uid') uid: string): Promise<{ ok: true }> {
    // Só membro do polo: o admin de um polo não dispara e-mail nem derruba a sessão de quem é de outro.
    if (!(await this.members.isMember(tenant.id, uid))) throw new NotFoundException('Usuário não encontrado neste polo.')
    // O link troca a senha e as sessões caem na rede inteira (B4): quem não é da plataforma só redefine a de quem é só do
    // polo. Conta da plataforma e quem tem qualquer vínculo com outro polo (até o passivo, criado pelo login: definição
    // ampla) ficam com o Studio Pilari.
    const ator = actorOf(current, tenant)
    await this.members.assertNotPlatformAccount(ator.isPlatformAdmin, uid)
    if (!ator.isPlatformAdmin && (await this.members.isLinkedOutside(tenant.id, uid))) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'SHARED_USER_PLATFORM_ONLY',
        message: 'Esta pessoa também está ligada a outro polo da rede, e a senha vale em todos eles: quem redefine a senha é o Studio Pilari.',
      })
    }
    // A07: o admin NÃO define mais a senha (senha conhecida por terceiro). O Firebase envia
    // ao titular o link de redefinição; revogamos as sessões ativas (força novo login).
    const fbUser = await this.identityService.getFirebaseUser(uid)
    if (!fbUser.email) throw new BadRequestException('Usuário sem e-mail cadastrado.')
    await this.identityService.sendPasswordResetEmail(fbUser.email)
    await this.identityService.revokeTokens(uid)
    this.audit.log({ tenantId: tenant.id, actorUid: current.uid, actorEmail: current.email, action: 'user.password-reset', summary: `Enviou link de redefinição de senha ao usuário ${uid}`, targetType: 'user', targetId: uid })
    return { ok: true }
  }

  // ── Cortesia: admin dá/retira acesso a curso DO POLO de um aluno ─────────────

  @Get(':uid/enrollments')
  async enrollments(@CurrentTenant() tenant: TenantContext, @Param('uid') uid: string): Promise<{ enrollments: AdminEnrollment[] }> {
    return { enrollments: await this.admin.listUserEnrollments(tenant.id, uid) }
  }

  @Post(':uid/enrollments')
  async grant(
    @CurrentUser() current: DecodedFirebaseUser,
    @CurrentTenant() tenant: TenantContext,
    @Param('uid') uid: string,
    @Body() dto: GrantEnrollmentDto
  ): Promise<{ enrollment: AdminEnrollment }> {
    // Polo suspenso não ganha matrícula nova, nem pela plataforma (B12). Criar e editar usuário continuam.
    if (tenant.status !== 'active') throw tenantSuspendedForEnrollment()
    // A cortesia cria o vínculo de aluno: conta da equipe do Studio Pilari não o ganha pelo polo (B4).
    await this.members.assertNotPlatformAccount(actorOf(current, tenant).isPlatformAdmin, uid)
    const enrollment = await this.admin.grantEnrollment(tenant.id, uid, dto.courseId)
    const pessoa = await this.admin.personLabel(uid)
    this.audit.log({ tenantId: tenant.id, actorUid: current.uid, actorEmail: current.email, action: 'enrollment.grant', summary: `Liberou o curso "${enrollment.courseTitle}" para ${pessoa}`, targetType: 'user', targetId: uid })
    return { enrollment }
  }

  @Delete(':uid/enrollments/:courseId')
  async revoke(
    @CurrentUser() current: DecodedFirebaseUser,
    @CurrentTenant() tenant: TenantContext,
    @Param('uid') uid: string,
    @Param('courseId') courseId: string
  ): Promise<{ ok: true }> {
    // Como na concessão: o acesso da conta da equipe do Studio Pilari não é tirado pelo polo (B4).
    await this.members.assertNotPlatformAccount(actorOf(current, tenant).isPlatformAdmin, uid)
    const titulo = await this.admin.courseTitle(tenant.id, courseId)
    const result = await this.admin.revokeEnrollment(tenant.id, uid, courseId)
    const pessoa = await this.admin.personLabel(uid)
    this.audit.log({ tenantId: tenant.id, actorUid: current.uid, actorEmail: current.email, action: 'enrollment.revoke', summary: `Removeu o acesso de ${pessoa} ao curso "${titulo}"`, targetType: 'user', targetId: uid })
    return result
  }
}
