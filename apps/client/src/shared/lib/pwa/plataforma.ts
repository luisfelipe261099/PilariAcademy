/** Regras puras do convite para instalar o app (testáveis sem navegador). */

/**
 * iPhone ou iPad. O iPadOS se apresenta como Mac, mas tem tela de toque. No iOS não existe o diálogo de instalar:
 * o aluno instala pelo Compartilhar do Safari, então o convite vira instrução.
 */
export function ehIos(userAgent: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)
}

/** Já aberto como app instalado: pelo display-mode (Chrome, Edge, Android) ou pelo `navigator.standalone` do iOS. */
export function abertoComoApp(displayModeStandalone: boolean, navigatorStandalone: boolean | undefined): boolean {
  return displayModeStandalone || navigatorStandalone === true
}

export interface SituacaoDoApp {
  podeInstalar: boolean
  instalado: boolean
  ios: boolean
}

/** O que o convite mostra: o botão (o navegador ofereceu), a instrução do iPhone, ou nada. */
export function conviteDoApp(s: SituacaoDoApp, dispensado: boolean): 'botao' | 'instrucao-ios' | null {
  if (s.instalado || dispensado) return null
  if (s.podeInstalar) return 'botao'
  return s.ios ? 'instrucao-ios' : null
}
