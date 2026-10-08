const digitos = (v: string): string => v.replace(/\D/g, '')

/** Link do WhatsApp (wa.me). null quando não há número válido: o botão some. */
export function whatsappHref(numero: string | null | undefined, texto?: string): string | null {
  const d = numero ? digitos(numero) : ''
  if (d.length < 10) return null
  return `https://wa.me/${d}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`
}

// Só dígitos e a pontuação comum de telefone: qualquer letra, barra ou vírgula é "texto", não número.
const SO_NUMERO = /^[\d\s().+-]+$/
// 0800, 0300, 0500 e 0900: número de serviço, discado como está, sem +55 e sem tirar o zero.
const SERVICO = /^0[3589]00\d{6,7}$/

/** DDD + número: 10 dígitos (fixo, começa em 2 a 5) ou 11 (celular, começa em 9). DDD nunca tem zero. */
function nacionalValido(d: string): boolean {
  if (!/^[1-9][1-9]/.test(d)) return false
  if (d.length === 10) return /[2-5]/.test(d[2])
  return d.length === 11 && d[2] === '9'
}

/**
 * Link de telefone, só quando o texto é UM número plausível. O campo do polo é texto livre: dois
 * números ("(41) 3333-4444 / (41) 99999-8888"), ramal ou um número sem DDD não viram link, porque
 * colar os dígitos discaria um número que não existe. Brasileiro sem país ganha +55, o zero do
 * tronco ("041 ...") cai, e 0800 fica como está.
 */
export function telHref(telefone: string | null | undefined): string | null {
  const texto = telefone?.trim() ?? ''
  if (!texto || !SO_NUMERO.test(texto)) return null
  const d = digitos(texto)
  if (texto.startsWith('+')) {
    if (texto.indexOf('+', 1) !== -1 || d.startsWith('0')) return null
    if (d.startsWith('55')) return d.length >= 12 && nacionalValido(d.slice(2)) ? `tel:+${d}` : null
    return d.length >= 8 && d.length <= 15 ? `tel:+${d}` : null
  }
  if (texto.includes('+')) return null
  if (SERVICO.test(d)) return `tel:${d}`
  const n = d.startsWith('0') ? d.slice(1) : d
  if (nacionalValido(n)) return `tel:+55${n}`
  if (n.startsWith('55') && nacionalValido(n.slice(2))) return `tel:+${n}`
  return null
}

/**
 * O telefone do polo como o rodapé o mostra: o texto sempre aparece, do jeito que o polo o digitou, e
 * só vira link quando é um número só. null quando não há texto.
 */
export function phoneContact(telefone: string | null | undefined): { text: string; href: string | null } | null {
  const text = telefone?.trim() ?? ''
  return text ? { text, href: telHref(text) } : null
}

/**
 * mailto: com o endereço codificado (o @ fica). A regex de e-mail do servidor aceita ?, & e #, que
 * quebrariam o link se fossem coladas como estão.
 */
export function mailtoHref(email: string, assunto?: string): string {
  const para = encodeURIComponent(email).replace(/%40/g, '@')
  return `mailto:${para}${assunto ? `?subject=${encodeURIComponent(assunto)}` : ''}`
}

export function mapsHref(endereco: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(endereco)}`
}

/**
 * Como o aluno se matricula num polo sem venda online: WhatsApp do polo, senão e-mail, senão
 * telefone. null quando o polo não cadastrou contato.
 */
export function enrollContact(
  b: { whatsapp: string | null; email: string | null; phone: string | null },
  courseTitle: string
): { href: string; external: boolean } | null {
  const wa = whatsappHref(b.whatsapp, `Olá! Quero me matricular no curso ${courseTitle}.`)
  if (wa) return { href: wa, external: true }
  if (b.email) return { href: mailtoHref(b.email, `Matrícula: ${courseTitle}`), external: false }
  const tel = telHref(b.phone)
  return tel ? { href: tel, external: false } : null
}

export interface EnrollChannel {
  kind: 'whatsapp' | 'email' | 'phone'
  /** O texto do botão (ou da linha, quando não há link). */
  label: string
  /** null: o telefone é texto livre e não virou um número discável; a tela mostra o texto sem link. */
  href: string | null
  external: boolean
}

/**
 * Todos os canais que o polo cadastrou para o aluno se matricular, quando ainda não há curso escolhido (o carrinho de um
 * polo sem venda): WhatsApp, e-mail e telefone, nessa ordem, cada um pelo mesmo helper que o resto do site usa
 * (`whatsappHref`, `mailtoHref`, `phoneContact`). O e-mail e o telefone mostram o endereço e o número no texto: quem não
 * tem programa de e-mail configurado ou está no computador precisa ver para onde escrever e para quem ligar. Lista vazia
 * = o polo não cadastrou contato nenhum.
 */
export function enrollChannels(b: { whatsapp: string | null; email: string | null; phone: string | null }): EnrollChannel[] {
  const canais: EnrollChannel[] = []
  const wa = whatsappHref(b.whatsapp, 'Olá! Quero me matricular.')
  if (wa) canais.push({ kind: 'whatsapp', label: 'Falar no WhatsApp', href: wa, external: true })
  const email = b.email?.trim()
  if (email) canais.push({ kind: 'email', label: `Escrever para ${email}`, href: mailtoHref(email, 'Matrícula'), external: false })
  const tel = phoneContact(b.phone)
  if (tel) canais.push({ kind: 'phone', label: tel.href ? `Ligar para ${tel.text}` : `Telefone: ${tel.text}`, href: tel.href, external: false })
  return canais
}
