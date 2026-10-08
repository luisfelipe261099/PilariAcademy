import { SetMetadata } from '@nestjs/common'

export const AUTHENTICATED_KEY = 'authenticated'

/**
 * Marca um endpoint como acessível a QUALQUER usuário autenticado (sem papel específico).
 * Necessário porque o RolesGuard é global e nega por padrão: uma rota de aluno precisa dizer
 * explicitamente "basta estar logado", senão seria negada junto com as que esquecem @Roles().
 */
export const Authenticated = () => SetMetadata(AUTHENTICATED_KEY, true)
