import { randomBytes, randomInt } from 'node:crypto'

const MINUSCULAS = 'abcdefghijklmnopqrstuvwxyz'
const MAIUSCULAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const DIGITOS = '0123456789'
/** Símbolos que a política de senha do Firebase conta como "não alfanumérico". */
const SIMBOLOS = '!@#$%&*?'

const sortear = (conjunto: string): string => conjunto[randomInt(conjunto.length)]

/**
 * Senha que ninguém conhece, para a conta que a plataforma cria: o titular define a dele pelo link de redefinição.
 * São 32 caracteres aleatórios (base64url, 192 bits) e, no fim, um de cada classe (minúscula, maiúscula, dígito e
 * símbolo). O trecho aleatório pode sair sem alguma das classes; o fim garante as quatro, então nenhuma política de
 * senha do Firebase a recusa. `bytes` existe para o teste fixar o pior caso.
 */
export function randomPassword(bytes: Buffer = randomBytes(24)): string {
  return bytes.toString('base64url') + sortear(MINUSCULAS) + sortear(MAIUSCULAS) + sortear(DIGITOS) + sortear(SIMBOLOS)
}
