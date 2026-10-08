import { SetMetadata } from '@nestjs/common'

export const PLATFORM_ADMIN_KEY = 'platformAdmin'

/**
 * Rota exclusiva da equipe do Studio Pilari: admin da plataforma EFETIVO (users.is_platform_admin OU admin da matriz, ver
 * `isEffectivePlatformAdmin`). Mais restrita que @Roles(admin).
 */
export const PlatformAdmin = () => SetMetadata(PLATFORM_ADMIN_KEY, true)
