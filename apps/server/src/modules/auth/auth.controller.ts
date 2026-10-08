import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common'
import type { EditableProfile } from '@pilari/types'
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard'
import { Authenticated } from '../../common/decorators/authenticated.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { DecodedFirebaseUser } from '../../common/types/user.type'
import { effectiveRoles, isEffectivePlatformAdmin } from '../../common/lib/effective-roles'
import { CurrentTenant } from '../tenancy/current-tenant.decorator'
import type { TenantContext } from '../tenancy/tenant-context'
import { TenantMembersService } from '../tenancy/tenant-members.service'
import { AuthService } from './auth.service'
import { IdentityService } from './identity.service'
import { SyncUserDto } from './dto/sync-user.dto'
import { UpdateProfileDto } from './dto/update-profile.dto'
import { toAuthUser } from './to-auth-user'

function toEditableProfile(
  u: { displayName: string | null; photoUrl: string | null; headline: string | null; bio: string | null; email?: string | null; cpf?: string | null } | null
): EditableProfile {
  const cpf = (u?.cpf ?? '').replace(/\D/g, '')
  return {
    displayName: u?.displayName ?? null,
    photoUrl: u?.photoUrl ?? null,
    headline: u?.headline ?? null,
    bio: u?.bio ?? null,
    email: u?.email ?? null,
    cpf: cpf || null,
    // A tela não deve inferir isto de `cpf !== null`: quem decide se o campo trava é a
    // mesma regra que o service aplica ao gravar, e ela mora aqui.
    cpfLocked: cpf.length === 11,
  }
}

@Controller('auth')
@Authenticated()
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly identityService: IdentityService,
    private readonly members: TenantMembersService
  ) {}

  /**
   * Chamado pelo cliente a cada sessão: espelha o usuário e garante o vínculo de aluno NESTE polo. Nome e foto (do corpo
   * ou do Firebase) só preenchem cadastro vazio: nunca desfazem uma correção (upsertUser).
   */
  @Post('sync-user-data')
  @UseGuards(FirebaseAuthGuard)
  async syncUserData(@CurrentUser() user: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Body() body: SyncUserDto) {
    const firebaseUser = await this.identityService.getFirebaseUser(user.uid)
    const dbUser = await this.authService.upsertUser({
      uid: firebaseUser.uid,
      email: firebaseUser.email || '',
      displayName: body.displayName ?? firebaseUser.displayName ?? '',
      photoUrl: body.photoUrl ?? firebaseUser.photoURL ?? '',
    })
    // Admin da plataforma é o EFETIVO (B10): o sinal do cadastro ou o admin da matriz, lidos junto com o vínculo daqui.
    const vinculos = await this.members.rolesHereAndInMatriz(tenant.id, dbUser.uid)
    const isPlatformAdmin = isEffectivePlatformAdmin(dbUser.isPlatformAdmin, vinculos.matrizRoles)
    // A equipe da plataforma não vira aluna dos polos que visita: já age como admin em todos.
    let papeis = vinculos.roles
    if (!papeis && !isPlatformAdmin) {
      await this.members.ensureStudent(tenant.id, dbUser.uid)
      papeis = await this.members.rolesOf(tenant.id, dbUser.uid)
    }
    const roles = effectiveRoles(papeis ?? [], isPlatformAdmin)
    return { user: toAuthUser(dbUser, roles, isPlatformAdmin), roles }
  }

  @Get('me')
  @UseGuards(FirebaseAuthGuard)
  async getMe(@CurrentUser() user: DecodedFirebaseUser) {
    const dbUser = await this.authService.getUserByUid(user.uid)
    if (!dbUser) return { user: null, roles: [] }
    // Papéis e isPlatformAdmin já vêm efetivos do guard (o vínculo deste polo e o da matriz).
    const authUser = toAuthUser(dbUser, user.roles ?? [], user.isPlatformAdmin === true)
    return { user: authUser, roles: authUser.roles }
  }

  @Get('profile')
  @UseGuards(FirebaseAuthGuard)
  async getProfile(@CurrentUser() user: DecodedFirebaseUser): Promise<EditableProfile> {
    return toEditableProfile(await this.authService.getUserByUid(user.uid))
  }

  @Patch('profile')
  @UseGuards(FirebaseAuthGuard)
  async updateProfile(
    @CurrentUser() user: DecodedFirebaseUser,
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: UpdateProfileDto
  ): Promise<EditableProfile> {
    // Pessoa compartilhada é vista do polo do endereço (B8).
    const quem = { tenantId: tenant.id, isPlatformAdmin: user.isPlatformAdmin === true }
    return toEditableProfile(await this.authService.updateProfile(quem, user.uid, dto))
  }
}
