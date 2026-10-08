import { brandTokens } from './brand-tokens'

type Bloco = ':root' | ':root.dark'

function valor(css: string, bloco: Bloco, nome: string): string | undefined {
  const corpo = css.match(new RegExp(`${bloco.replace('.', '\\.')}\\{([^}]*)\\}`))?.[1] ?? ''
  return corpo.split(';').map((d) => d.split(':')).find(([k]) => k === nome)?.[1]
}

/** Todos os tokens de um bloco, nome → valor. */
function tokens(css: string, bloco: Bloco): Record<string, string> {
  const corpo = css.match(new RegExp(`${bloco.replace('.', '\\.')}\\{([^}]*)\\}`))?.[1] ?? ''
  return Object.fromEntries(corpo.split(';').map((d) => [d.slice(0, d.indexOf(':')), d.slice(d.indexOf(':') + 1)]))
}

// Referência independente (nada aqui vem do módulo testado): contraste do WCAG 2.x entre dois #rrggbb.
const canais = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
function luminancia(hex: string): number {
  const [r, g, b] = canais(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contraste(a: string, b: string): number {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x)
  return (claro + 0.05) / (escuro + 0.05)
}
function matizESaturacao(hex: string): { h: number; s: number } {
  const [r, g, b] = canais(hex).map((c) => c / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max === min) return { h: 0, s: 0 }
  const d = max - min
  const l = (max + min) / 2
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: h * 60, s: s * 100 }
}

const MIN = 4.5

// Gerador de #rrggbb a partir de HSL só para as grades de teste (por setores do círculo cromático; nada vem do módulo).
function hslParaHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs((2 * l) / 100 - 1)) * (s / 100)
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l / 100 - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  const canal = (v: number): string => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return `#${canal(r)}${canal(g)}${canal(b)}`
}

/** `--color-surface` do tema escuro em apps/client/src/app/styles/colors.css: o polo não a sobrescreve. */
const SUPERFICIE_ESCURA = '#262d26'
/** Sob texto claro a superfície mais clara é a de menor contraste, então é a que decide. */
const maisClara = (a: string, b: string): string => (luminancia(a) >= luminancia(b) ? a : b)
/** Contraste entre dois tokens; 0 se algum não existe, para o alvo reprovar em vez de a conferência quebrar. */
const razao = (a: string | undefined, b: string | undefined): number => (a && b ? contraste(a, b) : 0)

/** Os nove alvos de contraste dos tons que o client usa como texto, nome → razão (WCAG 2.x). */
function alvos(css: string): Record<string, number> {
  const claro = tokens(css, ':root')
  const escuro = tokens(css, ':root.dark')
  return {
    'claro: --color-brand x #ffffff': razao(claro['--color-brand'], '#ffffff'),
    'claro: --color-accent x --color-surface': razao(claro['--color-accent'], claro['--color-surface']),
    'claro: --color-accent x --color-brand-soft': razao(claro['--color-accent'], claro['--color-brand-soft']),
    'claro: --color-brand-bright x #ffffff': razao(claro['--color-brand-bright'], '#ffffff'),
    'escuro: --color-brand x #ffffff': razao(escuro['--color-brand'], '#ffffff'),
    'escuro: --color-accent x #262d26': razao(escuro['--color-accent'], SUPERFICIE_ESCURA),
    'escuro: --color-accent x --color-brand-soft': razao(escuro['--color-accent'], escuro['--color-brand-soft']),
    'escuro: --color-brand-bright x #262d26': razao(escuro['--color-brand-bright'], SUPERFICIE_ESCURA),
    'escuro: --color-brand-bright x --color-brand-soft': razao(escuro['--color-brand-bright'], escuro['--color-brand-soft']),
  }
}

describe('brandTokens', () => {
  it('usa as cores do polo nos tokens principais', () => {
    const css = brandTokens('#0055aa', '#ff6600')
    expect(valor(css, ':root', '--color-brand')).toBe('#0055aa')
    expect(valor(css, ':root', '--color-accent')).toBe('#0055aa')
    expect(valor(css, ':root', '--color-cta')).toBe('#ff6600')
    expect(valor(css, ':root', '--grid-line')).toBe('rgba(0, 85, 170, 0.13)')
  })

  it('gera as variações do tema escuro', () => {
    const css = brandTokens('#0055aa', '#ff6600')
    for (const nome of ['--color-brand', '--color-brand-bright', '--color-accent', '--color-brand-soft', '--grid-line']) {
      expect(valor(css, ':root.dark', nome)).toBeDefined()
    }
    expect(valor(css, ':root.dark', '--color-brand')).not.toBe('#0055aa')
  })

  it('cor inválida cai nas cores da matriz', () => {
    const css = brandTokens('azul', 'laranja')
    expect(valor(css, ':root', '--color-brand')).toBe('#5c6e5a')
    expect(valor(css, ':root', '--color-cta')).toBe('#c67c89')
  })

  it('cor principal clara demais é escurecida para o texto branco dos botões continuar legível', () => {
    const roxo = valor(brandTokens('#ffee00', '#ff6600'), ':root', '--color-brand')!
    expect(roxo).not.toBe('#ffee00')
    expect(contraste('#ffffff', roxo)).toBeGreaterThanOrEqual(MIN)
  })

  it('nunca produz < ou > (vai dentro de <style>)', () => {
    expect(brandTokens('#0055aa', '#ff6600')).not.toMatch(/[<>]/)
    for (const [p, a] of [['#ffee00', '#00ffff'], ['#808080', '#ffffff'], ['#000000', '#000000'], ['</style><b>', '"><script>']]) {
      expect(brandTokens(p, a)).not.toMatch(/[<>]/)
    }
  })
})

describe('referência de contraste do teste', () => {
  it('bate com os valores conhecidos do WCAG', () => {
    expect(contraste('#ffffff', '#000000')).toBeCloseTo(21, 5)
    expect(contraste('#767676', '#ffffff')).toBeGreaterThanOrEqual(MIN) // o cinza mais claro que passa em AA sobre branco
    expect(contraste('#777777', '#ffffff')).toBeLessThan(MIN)
  })
})

/** Cores que o polo pode escolher: as que falhavam com o teto de luminosidade HSL e algumas de borda. */
const CORES: Array<[string, string]> = [
  ['amarelo', '#ffee00'], ['verde', '#00ff00'], ['ciano', '#00ffff'], ['dourado', '#d4af37'], ['marinho', '#001a4d'],
  ['cinza', '#808080'], ['vermelho', '#ff0000'], ['magenta', '#ff00ff'], ['laranja', '#ffa500'], ['azul puro', '#0000ff'],
  ['branco', '#ffffff'], ['preto', '#000000'],
]

describe('brandTokens: contraste legível (WCAG AA, 4.5:1)', () => {
  it.each(CORES)('%s (%s): texto branco no roxo e roxo/acento como texto nos dois temas', (_nome, cor) => {
    const css = brandTokens(cor, '#ff6600')
    const medidas = {
      'branco sobre --color-brand (claro)': contraste('#ffffff', valor(css, ':root', '--color-brand')!),
      '--color-accent (claro) sobre branco': contraste('#ffffff', valor(css, ':root', '--color-accent')!),
      'branco sobre --color-brand (escuro)': contraste('#ffffff', valor(css, ':root.dark', '--color-brand')!),
      '--color-accent (escuro) sobre preto': contraste('#000000', valor(css, ':root.dark', '--color-accent')!),
    }
    expect(Object.entries(medidas).filter(([, razao]) => razao < MIN)).toEqual([])
  })

  it.each([['amarelo', '#ffee00'], ['verde', '#00ff00'], ['ciano', '#00ffff'], ['dourado', '#d4af37']])(
    '%s (%s): escurece mantendo matiz e saturação, e só até passar',
    (_nome, cor) => {
      const roxo = valor(brandTokens(cor, '#ff6600'), ':root', '--color-brand')!
      const original = matizESaturacao(cor)
      const novo = matizESaturacao(roxo)
      expect(Math.abs(novo.h - original.h)).toBeLessThanOrEqual(3)
      expect(Math.abs(novo.s - original.s)).toBeLessThanOrEqual(6)
      const razao = contraste('#ffffff', roxo)
      expect(razao).toBeGreaterThanOrEqual(MIN)
      expect(razao).toBeLessThan(4.7) // não passou do ponto: é o tom mais claro que ainda atinge 4.5
    }
  )

  it('o tom mais claro de cinza que passa é o #767676', () => {
    expect(valor(brandTokens('#777777', '#ff6600'), ':root', '--color-brand')).toBe('#767676')
    expect(valor(brandTokens('#ffffff', '#ff6600'), ':root', '--color-brand')).toBe('#767676')
  })

  it('o acento do tema escuro sobe até passar na superfície escura mais clara (marinho dava 3.8:1 no preto)', () => {
    const css = brandTokens('#001a4d', '#ff6600')
    const acento = valor(css, ':root.dark', '--color-accent')!
    // O acento é texto sobre o preto, sobre o #262d26 e sobre o brand-soft derivado: decide o mais claro dos dois últimos.
    const superficie = maisClara(SUPERFICIE_ESCURA, valor(css, ':root.dark', '--color-brand-soft')!)
    expect(contraste('#000000', acento)).toBeGreaterThanOrEqual(MIN)
    expect(contraste(superficie, acento)).toBeGreaterThanOrEqual(MIN)
    expect(contraste(superficie, acento)).toBeLessThan(4.7)
  })
})

describe('brandTokens: grade de cores (propriedades para qualquer cor)', () => {
  const PASSOS = [0, 25, 50, 75, 100, 125, 150, 175, 200, 225, 250, 255]
  const hex2 = (n: number): string => n.toString(16).padStart(2, '0')
  const rgbDe = (v: string): number[] => (v.startsWith('#') ? canais(v) : (v.match(/\d+/g) ?? []).slice(0, 3).map(Number))

  it('toda cor da grade (1728) cumpre os quatro contrastes, só escurece o necessário e cinza fica cinza', () => {
    const falhas: string[] = []
    for (const r of PASSOS) {
      for (const g of PASSOS) {
        for (const b of PASSOS) {
          const cor = `#${hex2(r)}${hex2(g)}${hex2(b)}`
          const css = brandTokens(cor, '#ff6600')
          if (/NaN|undefined|[<>]/.test(css)) falhas.push(`${cor}: saída inválida`)
          const claro = tokens(css, ':root')
          const escuro = tokens(css, ':root.dark')
          const razoes = [
            contraste('#ffffff', claro['--color-brand']), contraste('#ffffff', claro['--color-accent']),
            contraste('#ffffff', escuro['--color-brand']), contraste('#000000', escuro['--color-accent']),
          ]
          if (razoes.some((x) => x < MIN)) falhas.push(`${cor}: contrastes ${razoes.map((x) => x.toFixed(3)).join(' ')}`)
          // O acento é texto sobre a --color-surface clara (mais escura que o branco): é o próprio roxo enquanto o roxo passa
          // nela; senão escurece só até passar.
          const acentoPassaNaSuperficie = contraste(cor, claro['--color-surface']) >= MIN
          if (contraste(cor, '#ffffff') >= MIN) {
            if (claro['--color-brand'] !== cor) falhas.push(`${cor}: já passava e mudou para ${claro['--color-brand']}`)
            if (acentoPassaNaSuperficie && claro['--color-accent'] !== cor) falhas.push(`${cor}: o acento já passava na superfície e mudou para ${claro['--color-accent']}`)
          } else if (razoes[0] >= 4.7) {
            falhas.push(`${cor}: escureceu demais (${razoes[0].toFixed(3)})`)
          }
          if (claro['--color-accent'] !== claro['--color-brand'] && contraste(claro['--color-accent'], claro['--color-surface']) >= 4.7) {
            falhas.push(`${cor}: o acento escureceu demais na superfície (${contraste(claro['--color-accent'], claro['--color-surface']).toFixed(3)})`)
          }
          if (r === g && g === b) {
            for (const [nome, v] of [...Object.entries(claro), ...Object.entries(escuro)]) {
              if (!nome.startsWith('--color-cta') && new Set(rgbDe(v)).size !== 1) falhas.push(`${cor}: ${nome} ${v} com matiz`)
            }
          }
        }
      }
    }
    expect(falhas).toEqual([])
  })
})

describe('brandTokens: tons secundários legíveis (grade de matiz, saturação e luminosidade)', () => {
  it('toda cor da grade (1200) cumpre os nove alvos de contraste nos dois temas', () => {
    const falhasPorAlvo: Record<string, string[]> = {}
    let cores = 0
    for (let h = 0; h <= 345; h += 15) {
      for (const s of [0, 25, 50, 75, 100]) {
        for (let l = 5; l <= 95; l += 10) {
          const cor = hslParaHex(h, s, l)
          cores += 1
          for (const [alvo, r] of Object.entries(alvos(brandTokens(cor, '#ff6600')))) {
            if (!(r >= MIN)) (falhasPorAlvo[alvo] ??= []).push(`${cor} ${r.toFixed(3)}`)
          }
        }
      }
    }
    expect(cores).toBe(1200)
    // Cada alvo que falha sai com a contagem e três exemplos, em vez de milhares de linhas.
    expect(Object.fromEntries(Object.entries(falhasPorAlvo).map(([alvo, f]) => [alvo, `${f.length} falhas, ex.: ${f.slice(0, 3).join(' | ')}`]))).toEqual({})
  })
})

// Todos os casos abaixo falhavam antes da correção, menos os de primária saturada (guarda: já passavam e não podem mudar).
describe('brandTokens: casos nomeados dos tons secundários', () => {
  it('#0055aa: o roxo vivo do tema claro escurece só até 4.5 no branco (dava 3.30:1)', () => {
    const css = brandTokens('#0055aa', '#ff6600')
    const vivo = valor(css, ':root', '--color-brand-bright')!
    expect(contraste(vivo, '#ffffff')).toBeGreaterThanOrEqual(MIN)
    expect(contraste(vivo, '#ffffff')).toBeLessThan(4.7)
    // O roxo e o acento claro seguem exatamente a cor do polo.
    expect(valor(css, ':root', '--color-brand')).toBe('#0055aa')
    expect(valor(css, ':root', '--color-accent')).toBe('#0055aa')
  })

  // Primária saturada (verde, turquesa) já passava com folga no tema escuro. O que reprovava eram os verdes e turquesas quase
  // pretos e acinzentados, em que o acento cai rente a 4.5 no #262d26.
  it.each([['verde quase cinza', '#252825'], ['turquesa quase preto', '#0d1012']])(
    '%s (%s): o acento do tema escuro passa na superfície derivada e só sobe até passar',
    (_nome, cor) => {
      const css = brandTokens(cor, '#ff6600')
      const acento = valor(css, ':root.dark', '--color-accent')!
      const superficie = maisClara(SUPERFICIE_ESCURA, valor(css, ':root.dark', '--color-brand-soft')!)
      expect(contraste(acento, superficie)).toBeGreaterThanOrEqual(MIN)
      expect(contraste(acento, superficie)).toBeLessThan(4.7)
    }
  )

  it('turquesa quase preto (#14181a): o brand-soft escuro derivado (l 10) fica abaixo do #262d26, então o acento passa na superfície fixa', () => {
    const css = brandTokens('#14181a', '#ff6600')
    const soft = valor(css, ':root.dark', '--color-brand-soft')!
    const acento = valor(css, ':root.dark', '--color-accent')!
    // Com o canvas verde-escuro do Studio Pilari, a superfície fixa é a mais clara: é nela que o acento tem de passar.
    expect(luminancia(soft)).toBeLessThan(luminancia(SUPERFICIE_ESCURA))
    expect(contraste(acento, SUPERFICIE_ESCURA)).toBeGreaterThanOrEqual(MIN)
    expect(contraste(acento, soft)).toBeGreaterThanOrEqual(MIN)
  })

  // Guarda: o acento que já passa não é mexido (valores medidos antes da correção).
  it.each([['verde #2e8b57', '#2e8b57', '#81c69f'], ['turquesa #0d9488', '#0d9488', '#4ed7cb']])(
    'primária saturada (%s) já passava com folga: o acento do tema escuro não é mexido',
    (_nome, cor, acentoAnterior) => {
      expect(valor(brandTokens(cor, '#ff6600'), ':root.dark', '--color-accent')).toBe(acentoAnterior)
    }
  )

  it.each([['azul rente ao limite', '#0066cc'], ['azul do Google', '#1a73e8'], ['cinza no limite do branco', '#767676']])(
    '%s (%s): o roxo fica como o polo escolheu e o acento claro escurece só até passar na --color-surface',
    (_nome, cor) => {
      const css = brandTokens(cor, '#ff6600')
      const superficie = valor(css, ':root', '--color-surface')!
      const acento = valor(css, ':root', '--color-accent')!
      expect(valor(css, ':root', '--color-brand')).toBe(cor)
      expect(contraste(cor, superficie)).toBeLessThan(MIN) // é mesmo um caso em que o roxo não serve de texto na superfície
      expect(contraste(acento, superficie)).toBeGreaterThanOrEqual(MIN)
      expect(contraste(acento, superficie)).toBeLessThan(4.7)
      // A superfície l 91 é a mais escura onde o acento é texto: o brand-soft (l 93) e o branco herdam o contraste.
      expect(contraste(acento, valor(css, ':root', '--color-brand-soft')!)).toBeGreaterThanOrEqual(MIN)
      expect(contraste(acento, '#ffffff')).toBeGreaterThanOrEqual(MIN)
      const original = matizESaturacao(cor)
      const novo = matizESaturacao(acento)
      expect(Math.abs(novo.h - original.h)).toBeLessThanOrEqual(3)
      expect(Math.abs(novo.s - original.s)).toBeLessThanOrEqual(6)
    }
  )

  it('o tema escuro ganha o --color-brand-bright e ele clareia só até passar (marinho)', () => {
    const css = brandTokens('#001a4d', '#ff6600')
    const vivo = valor(css, ':root.dark', '--color-brand-bright')
    expect(vivo).toBeDefined()
    const superficie = maisClara(SUPERFICIE_ESCURA, valor(css, ':root.dark', '--color-brand-soft')!)
    expect(contraste(superficie, vivo!)).toBeGreaterThanOrEqual(MIN)
    expect(contraste(superficie, vivo!)).toBeLessThan(4.7)
  })
})

describe('brandTokens: cor que já é legível fica como o polo escolheu', () => {
  // #0000ff (8.6:1) estava acima do teto HSL antigo (virava #0000d6). O #767676 (4.54:1 no branco) segue sendo o roxo, mas
  // o acento dele não passa na --color-surface (3.7:1): fica nos casos do limite, mais abaixo.
  it.each(['#0055aa', '#5c6e5a', '#112233', '#0000ff'])('%s continua o mesmo roxo e o mesmo acento claro', (cor) => {
    const css = brandTokens(cor, '#ff6600')
    expect(valor(css, ':root', '--color-brand')).toBe(cor)
    expect(valor(css, ':root', '--color-accent')).toBe(cor)
    expect(valor(css, ':root', '--grid-line')).toBe(`rgba(${canais(cor).join(', ')}, 0.13)`)
  })

  // O roxo, o acento claro e os derivados de quem já passa não mudam; só os tons de texto (roxo vivo dos dois temas e acento
  // escuro) ganham o ajuste de contraste, e o tema escuro ganha o --color-brand-bright.
  it('a paleta de quem já passa só muda nos tons de texto (azul do polo, verde da matriz e marinho escuro)', () => {
    expect(brandTokens('#0055aa', '#ff6600')).toBe(
      ':root{--color-brand:#0055aa;--color-brand-dark:#003b77;--color-brand-bright:#1276db;--color-brand-overlay:#004890;--color-accent:#0055aa;--color-surface:#dee8f2;--color-brand-soft:#e5edf5;--color-border:#d9e3ed;--grid-line:rgba(0, 85, 170, 0.13);--color-cta:#ff6600;--color-cta-hover:#ff7214;--color-cta-light:#ffbc8f}\n' +
        ':root.dark{--color-brand:#006edd;--color-brand-bright:#3a95ef;--color-accent:#579fe7;--color-brand-soft:#141a1f;--grid-line:rgba(0, 110, 221, 0.16)}'
    )
    expect(brandTokens('#5c6e5a', '#c67c89')).toBe(
      ':root{--color-brand:#5c6e5a;--color-brand-dark:#404d3f;--color-brand-bright:#687c66;--color-brand-overlay:#4e5e4d;--color-accent:#5c6e5a;--color-surface:#e7eae6;--color-brand-soft:#ecefec;--color-border:#e2e5e1;--grid-line:rgba(92, 110, 90, 0.13);--color-cta:#c67c89;--color-cta-hover:#cc8a96;--color-cta-light:#ddb1b9}\n' +
        ':root.dark{--color-brand:#687c66;--color-brand-bright:#96a894;--color-accent:#a7b6a5;--color-brand-soft:#171c17;--grid-line:rgba(104, 124, 102, 0.16)}'
    )
    expect(brandTokens('#112233', '#ff6600')).toBe(
      ':root{--color-brand:#112233;--color-brand-dark:#0c1824;--color-brand-bright:#2e5d8b;--color-brand-overlay:#0e1d2b;--color-accent:#112233;--color-surface:#e3e8ed;--color-brand-soft:#e9edf1;--color-border:#dee3e8;--grid-line:rgba(17, 34, 51, 0.13);--color-cta:#ff6600;--color-cta-hover:#ff7214;--color-cta-light:#ffbc8f}\n' +
        ':root.dark{--color-brand:#264d73;--color-brand-bright:#6196ca;--color-accent:#6e95bd;--color-brand-soft:#141a1f;--grid-line:rgba(38, 77, 115, 0.16)}'
    )
  })
})

describe('brandTokens: cor legível acima do teto HSL antigo', () => {
  it('azul puro (luminosidade 50, 8.6:1) segue inteiro: os derivados partem da luminosidade real, não de um teto de 42', () => {
    // brand-dark = 35% (0.7 × 50) e brand-overlay = 42.5% (0.85 × 50); com o teto antigo seriam 29.4% e 35.7%.
    // Os tons de texto do tema escuro (roxo vivo e acento) sobem até 4.5 no #262d26; o resto é igual ao de antes.
    expect(brandTokens('#0000ff', '#ff6600')).toBe(
      ':root{--color-brand:#0000ff;--color-brand-dark:#0000b3;--color-brand-bright:#4c4cf0;--color-brand-overlay:#0000d9;--color-accent:#0000ff;--color-surface:#dedef2;--color-brand-soft:#e5e5f5;--color-border:#d9d9ed;--grid-line:rgba(0, 0, 255, 0.13);--color-cta:#ff6600;--color-cta-hover:#ff7214;--color-cta-light:#ffbc8f}\n' +
        ':root.dark{--color-brand:#0000e6;--color-brand-bright:#8686f5;--color-accent:#8787ee;--color-brand-soft:#14141f;--grid-line:rgba(0, 0, 230, 0.16)}'
    )
  })
})

describe('brandTokens: cor sem saturação não ganha matiz', () => {
  const rgbDe = (v: string): number[] => (v.startsWith('#') ? canais(v) : (v.match(/\d+/g) ?? []).slice(0, 3).map(Number))

  // A cor dos botões (laranja) tem matiz de propósito; só os tokens derivados da principal precisam ser neutros.
  it.each(['#000000', '#333333', '#808080', '#ffffff'])('%s: todos os tokens derivados dos dois temas têm canais iguais', (cor) => {
    const css = brandTokens(cor, '#ff6600')
    const coloridos: string[] = []
    let conferidos = 0
    for (const bloco of [':root', ':root.dark'] as const) {
      for (const [nome, v] of Object.entries(tokens(css, bloco))) {
        if (nome.startsWith('--color-cta')) continue
        conferidos += 1
        if (new Set(rgbDe(v)).size !== 1) coloridos.push(`${bloco} ${nome}: ${v}`)
      }
    }
    expect(coloridos).toEqual([])
    expect(conferidos).toBe(14) // 9 do claro + 5 do escuro: um token novo precisa entrar nesta conferência
  })

  it('cinza #808080 no escuro não fica avermelhado (dava #c69595 no acento)', () => {
    const acento = valor(brandTokens('#808080', '#ff6600'), ':root.dark', '--color-accent')!
    expect(new Set(canais(acento)).size).toBe(1)
  })

  it('cor com saturação mantém o toque do matiz nos neutros', () => {
    const css = brandTokens('#0055aa', '#ff6600')
    const [r, , b] = canais(valor(css, ':root', '--color-surface')!)
    expect(b).toBeGreaterThan(r)
  })
})
