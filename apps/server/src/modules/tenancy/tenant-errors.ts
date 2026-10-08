import { ForbiddenException, NotFoundException } from '@nestjs/common'

/** 404 de polo que não existe: o mesmo corpo do middleware, da loja e da Minha escola. */
export function tenantNotFound(): NotFoundException {
  return new NotFoundException({ statusCode: 404, code: 'TENANT_NOT_FOUND', message: 'Polo não encontrado.' })
}

/**
 * Polo suspenso não ganha matrícula nova pelo painel, nem pela plataforma no endereço dele (B12). A loja fechada tem a
 * mensagem do aluno, no StorefrontOpenGuard; o mesmo `code`.
 */
export function tenantSuspendedForEnrollment(): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    code: 'TENANT_SUSPENDED',
    message: 'O polo está suspenso: novas matrículas ficam bloqueadas até a regularização.',
  })
}
