import { ValidationPipe, type ValidationError } from '@nestjs/common'

/** "property X should not exist", com o caminho do objeto pai na frente quando o Nest achata erro aninhado ("a.property X ..."). */
const CAMPO_PROIBIDO = /^((?:[^\s.]+\.)*)property (\S+) should not exist$/

/**
 * Traduz a única mensagem padrão do class-validator que nenhum DTO consegue declarar: a do campo que não existe no DTO
 * (whitelist + forbidNonWhitelisted). As regras dos DTOs declaram a própria mensagem em português e passam como estão.
 */
export function traduzirMensagemDeValidacao(mensagem: string): string {
  const m = CAMPO_PROIBIDO.exec(mensagem)
  return m ? `O campo ${m[1]}${m[2]} não é aceito.` : mensagem
}

/**
 * O ValidationPipe global, com o formato de resposta de sempre (400, `message` com a lista, `error`), em português (B5).
 * Sobrescreve só o achatamento das mensagens: a fábrica de exceção padrão do Nest o chama, então status, formato e ordem
 * continuam os dele.
 */
export class PtBrValidationPipe extends ValidationPipe {
  protected override flattenValidationErrors(validationErrors: ValidationError[]): string[] {
    return super.flattenValidationErrors(validationErrors).map(traduzirMensagemDeValidacao)
  }
}
