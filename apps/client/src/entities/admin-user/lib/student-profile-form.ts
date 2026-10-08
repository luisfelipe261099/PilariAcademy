/**
 * Regras do formulário "Dados do aluno" na tela do admin. Espelham `AuthService.adminUpdateUser`
 * no servidor: se divergirem, o botão habilita um envio que volta 400.
 */
import { isValidFullName } from '@/entities/certificate/lib/certificate-form'

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '')
}

/** Máscara progressiva para o campo de CPF (aplica pontos e traço conforme digita). */
export function formatCpf(value: string): string {
  const d = onlyDigits(value).slice(0, 11)
  const parts = [d.slice(0, 3), d.slice(3, 6), d.slice(6, 9)].filter(Boolean)
  const base = parts.join('.')
  return d.length > 9 ? `${base}-${d.slice(9)}` : base
}

/** Dígitos verificadores do CPF. Sequências de um dígito só nunca são um CPF real. */
export function isValidCpf(value: string): boolean {
  const d = onlyDigits(value)
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  const dv = (len: number): number => {
    let sum = 0
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i)
    const rest = (sum * 10) % 11
    return rest === 10 ? 0 : rest
  }
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10])
}

/**
 * CPF que o servidor mascara ("***.***.***-**") para o admin de um polo quando a pessoa também está ligada
 * a outro polo: só o Studio Pilari vê os dígitos. CPF de verdade chega só com dígitos.
 */
export function isMaskedCpf(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.includes('*')
}

/** Frase de apoio do campo CPF na tela do admin. O carnê só é citado onde o polo vende. */
export function cpfHint(cpf: string | null | undefined, salesEnabled: boolean): string {
  if (isMaskedCpf(cpf)) return 'CPF visível só para o Studio Pilari: esta pessoa também está ligada a outro polo.'
  if (cpf) return 'Já cadastrado. Você pode corrigir; a alteração fica registrada no log.'
  return salesEnabled
    ? 'Ainda não informado. Necessário para emitir certificado e comprar no carnê.'
    : 'Ainda não informado. Necessário para emitir certificado.'
}

export interface AdminProfilePatch {
  displayName?: string
  cpf?: string
}

export type AdminProfileDecision =
  | { ok: true; patch: AdminProfilePatch }
  /** `error: null` = nada mudou (botão desabilitado, sem mensagem). */
  | { ok: false; error: string | null }

/**
 * Decide o que salvar a partir do que está no formulário. Só campos que mudaram entram no
 * patch; CPF vazio com CPF já gravado conta como "não mexeu" (apagar documento não é permitido).
 * Com o CPF mascarado (pessoa de outro polo) o campo é só leitura e o CPF nunca entra no patch.
 */
export function buildAdminProfilePatch(
  original: { displayName: string | null; cpf: string | null },
  form: { nome: string; cpf: string }
): AdminProfileDecision {
  const patch: AdminProfilePatch = {}
  const nome = form.nome.trim().replace(/\s+/g, ' ')
  if (nome !== (original.displayName ?? '').trim().replace(/\s+/g, ' ')) {
    if (!isValidFullName(nome)) return { ok: false, error: 'Informe o nome completo do aluno (sem e-mail).' }
    patch.displayName = nome
  }
  const cpf = isMaskedCpf(original.cpf) ? '' : onlyDigits(form.cpf)
  if (cpf && cpf !== (original.cpf ?? '')) {
    // Enquanto digita (menos de 11 dígitos) não é erro: só trava o salvar, sem aviso.
    if (cpf.length < 11) return { ok: false, error: null }
    if (!isValidCpf(cpf)) return { ok: false, error: 'CPF inválido: confira os dígitos.' }
    patch.cpf = cpf
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: null }
  return { ok: true, patch }
}
