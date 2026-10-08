import type { CreateUserResult } from '../api'

/**
 * Depois de criar um usuário: se o e-mail já tinha conta na rede, a pessoa só ganhou os papéis neste polo e a senha
 * digitada não foi usada. Sem o aviso, o admin repassaria uma senha que não vale. Servidor antigo (sem o campo) = sem aviso.
 */
export function createUserNotice(result: Pick<CreateUserResult, 'existingAccount'> | undefined): string | null {
  if (result?.existingAccount !== true) return null
  return 'Esta pessoa já tinha conta na rede e entra com a senha que já usa. A senha digitada não foi usada.'
}
