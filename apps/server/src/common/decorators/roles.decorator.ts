import { SetMetadata } from '@nestjs/common'
import { Role } from '@pilari/types'

export const ROLES_KEY = 'roles'

/** Marca os papéis exigidos por um endpoint. Use junto com o RolesGuard. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles)
