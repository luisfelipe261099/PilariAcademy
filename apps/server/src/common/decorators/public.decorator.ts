import { SetMetadata } from '@nestjs/common'

export const PUBLIC_KEY = 'isPublic'

/** Marca um endpoint como público (ignora o RolesGuard). */
export const Public = () => SetMetadata(PUBLIC_KEY, true)
