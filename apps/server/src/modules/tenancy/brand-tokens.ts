import { DEFAULT_ACCENT_COLOR, DEFAULT_PRIMARY_COLOR } from './branding'

const HEX = /^#[0-9a-fA-F]{6}$/
/** Contraste mínimo do WCAG AA para texto normal. Os botões roxos levam texto branco e o roxo também vira texto. */
const MIN_CONTRAST = 4.5
const BRANCO = '#ffffff'
/** `--color-surface` do tema escuro em apps/client/src/app/styles/colors.css: o polo não a sobrescreve. */
const SUPERFICIE_ESCURA = '#262d26'

interface Hsl {
  h: number
  s: number
  l: number
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHsl([r, g, b]: [number, number, number]): Hsl {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l: l * 100 }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0)
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return { h: h * 60, s: s * 100, l: l * 100 }
}

function hslToHex({ h, s, l }: Hsl): string {
  const sn = clamp(s, 0, 100) / 100
  const ln = clamp(l, 0, 100) / 100
  const k = (n: number): number => (n + h / 30) % 12
  const a = sn * Math.min(ln, 1 - ln)
  const f = (n: number): number => ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const to = (x: number): string => Math.round(x * 255).toString(16).padStart(2, '0')
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** Luminância relativa de um #rrggbb, pela fórmula do WCAG 2.x. */
function luminancia(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((canal) => {
    const c = canal / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Razão de contraste do WCAG 2.x entre dois #rrggbb: de 1 (iguais) a 21 (preto sobre branco). */
function contraste(a: string, b: string): number {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x)
  return (claro + 0.05) / (escuro + 0.05)
}

/**
 * Luminosidade da `cor` que chega ao contraste mínimo com o `fundo`, mantendo matiz e saturação: a própria
 * luminosidade se já passa; senão a mais próxima dela, andando em direção a `extremo` (0 = preto, 100 = branco, que
 * sempre passam). O contraste é medido no hex que vai para o CSS, já com os canais arredondados em 8 bits.
 */
function ajustaContraste(cor: Hsl, extremo: 0 | 100, fundo: string): number {
  const passa = (l: number): boolean => contraste(hslToHex({ ...cor, l }), fundo) >= MIN_CONTRAST
  if (passa(cor.l)) return cor.l
  let falha = cor.l
  let ok: number = extremo
  // Cada canal só cresce com a luminosidade, então o contraste é monotônico e a busca binária acha o limite.
  for (let i = 0; i < 24; i++) {
    const meio = (falha + ok) / 2
    if (passa(meio)) ok = meio
    else falha = meio
  }
  return ok
}

function bloco(seletor: string, vars: Record<string, string>): string {
  return `${seletor}{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';')}}`
}

/**
 * Tokens de cor do tema do polo, derivados da cor principal e da cor dos botões em HSL. Sobrescreve
 * as variáveis de `apps/client/src/app/styles/colors.css` para `:root` e `:root.dark`. Cor inválida
 * cai nas cores da matriz. A saída só tem hex e rgba: segura dentro de <style>.
 *
 * Legibilidade (WCAG AA, 4.5:1, medida no hex que vai para o CSS): o roxo leva texto branco nos botões e serve de
 * texto sobre branco, nos dois temas; no tema claro o acento é texto sobre a `--color-surface` (a superfície clara mais
 * escura onde ele aparece, então cobre também o `--color-brand-soft` e o branco) e o roxo vivo é texto sobre branco;
 * no tema escuro o acento e o roxo vivo são texto sobre a mais clara entre a `--color-surface` (#1a1a1a) e o
 * `--color-brand-soft` derivado. A cor que já passa fica exatamente como o polo escolheu; a que não passa escurece
 * (tema claro) ou clareia (tema escuro), com matiz e saturação mantidos, só até passar.
 */
export function brandTokens(primary: string, accent: string): string {
  const primaria = HEX.test(primary) ? primary.toLowerCase() : DEFAULT_PRIMARY_COLOR
  const acao = HEX.test(accent) ? accent.toLowerCase() : DEFAULT_ACCENT_COLOR
  const p = rgbToHsl(hexToRgb(primaria))
  // A cor que já passa fica exatamente como o polo escolheu; a outra escurece só até passar (mesmo matiz e saturação).
  const legivel = contraste(primaria, BRANCO) >= MIN_CONTRAST
  const base: Hsl = legivel ? p : { ...p, l: ajustaContraste(p, 0, BRANCO) }
  const roxo = legivel ? primaria : hslToHex(base)
  const a = rgbToHsl(hexToRgb(acao))
  // O piso de saturação dá aos tons neutros um toque do matiz da marca, mas nunca passa da saturação da própria cor:
  // preto, branco e cinza não ganham matiz (com o piso fixo, o matiz 0 deles virava um vermelho desbotado).
  const piso = (min: number): number => Math.min(min, base.s)

  // O acento do tema claro é texto sobre a --color-surface (l 91), a superfície clara mais escura onde ele aparece: o
  // --color-brand-soft (l 93) e o branco são mais claros e herdam o contraste. É o próprio roxo enquanto o roxo passa
  // nela; senão escurece só até passar.
  const superficie = hslToHex({ h: base.h, s: clamp(base.s * 0.45, piso(8), 45), l: 91 })
  const acentoNoClaro = contraste(roxo, superficie) >= MIN_CONTRAST ? roxo : hslToHex({ ...base, l: ajustaContraste(base, 0, superficie) })
  // O roxo vivo é texto (rótulos, links em hover) nos dois temas. Mesma derivação nos dois; cada tema ajusta a sua.
  const vivo: Hsl = { ...base, s: clamp(base.s, 0, 85), l: clamp(base.l + 23, 35, 62) }
  const vivoNoClaro = hslToHex({ ...vivo, l: ajustaContraste(vivo, 0, BRANCO) }) // texto sobre branco: escurece só até passar

  // No tema escuro o roxo sobe um pouco para aparecer no preto, sem perder o texto branco legível.
  const roxoEscuro: Hsl = { ...base, l: clamp(base.l + 10, 30, 45) }
  const roxoNoEscuro = hslToHex({ ...roxoEscuro, l: ajustaContraste(roxoEscuro, 0, BRANCO) })
  // No tema escuro o acento e o roxo vivo são texto sobre o preto, sobre a --color-surface (#1a1a1a) e sobre o
  // --color-brand-soft derivado, que em alguns matizes (verdes, turquesas) é um pouco mais claro que ela. Sob texto
  // claro a superfície mais clara é a de menor contraste: vale a mais clara das duas, e as mais escuras herdam o contraste.
  const suaveNoEscuro = hslToHex({ h: base.h, s: piso(20), l: 10 })
  const superficieEscura = luminancia(suaveNoEscuro) > luminancia(SUPERFICIE_ESCURA) ? suaveNoEscuro : SUPERFICIE_ESCURA
  const acentoEscuro: Hsl = { h: base.h, s: clamp(base.s * 0.75, piso(30), 80), l: clamp(base.l + 29, 50, 68) }
  const acentoNoEscuro = hslToHex({ ...acentoEscuro, l: ajustaContraste(acentoEscuro, 100, superficieEscura) }) // sobe até passar
  const vivoNoEscuro = hslToHex({ ...vivo, l: ajustaContraste(vivo, 100, superficieEscura) })

  const claro: Record<string, string> = {
    '--color-brand': roxo,
    '--color-brand-dark': hslToHex({ ...base, l: base.l * 0.7 }),
    '--color-brand-bright': vivoNoClaro,
    '--color-brand-overlay': hslToHex({ ...base, l: base.l * 0.85 }),
    '--color-accent': acentoNoClaro,
    '--color-surface': superficie,
    '--color-brand-soft': hslToHex({ h: base.h, s: clamp(base.s * 0.45, piso(8), 45), l: 93 }),
    '--color-border': hslToHex({ h: base.h, s: clamp(base.s * 0.35, piso(6), 35), l: 89 }),
    '--grid-line': rgba(roxo, 0.13),
    '--color-cta': acao,
    '--color-cta-hover': hslToHex({ ...a, l: clamp(a.l + 4, 0, 92) }),
    '--color-cta-light': hslToHex({ ...a, l: 78 }),
  }
  const escuro: Record<string, string> = {
    '--color-brand': roxoNoEscuro,
    '--color-brand-bright': vivoNoEscuro,
    '--color-accent': acentoNoEscuro,
    '--color-brand-soft': suaveNoEscuro,
    '--grid-line': rgba(roxoNoEscuro, 0.16),
  }
  return `${bloco(':root', claro)}\n${bloco(':root.dark', escuro)}`
}
