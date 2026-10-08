import { ForbiddenException } from '@nestjs/common'

/**
 * 403 do aluno com matrícula ativa num curso que saiu do ar (rascunho, em análise ou arquivado). Ele sabe que o curso
 * existe, porque comprou ou ganhou, então recebe um aviso em vez de um 404 que parece erro do site. Quem não tem
 * matrícula continua recebendo 404, que não revela o rascunho. Nos polos, quem explica a situação é o polo.
 */
export function courseUnavailable(isMatriz: boolean): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    code: 'COURSE_UNAVAILABLE',
    message: isMatriz ? 'Este curso está indisponível no momento.' : 'Este curso está indisponível no momento. Fale com o seu polo.',
  })
}
