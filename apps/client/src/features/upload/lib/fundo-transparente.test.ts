import { describe, expect, it } from 'vitest'
import { avisoDoResultado, classesDeBrilho, fundoParaAlfa } from './fundo-transparente'

type Cor = [number, number, number]

/** Monta um ImageData cru a partir de uma grade de cores, para testar sem canvas. */
function pixels(grade: Cor[][]): { data: Uint8ClampedArray; w: number; h: number } {
  const h = grade.length
  const w = grade[0].length
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const [r, g, b] = grade[y][x]
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  }
  return { data, w, h }
}

/** Fundo de `cor`, com `tinta` numa faixa central — o formato de um scan de assinatura. */
function scan(fundo: Cor, tinta: Cor, w = 20, h = 10): { data: Uint8ClampedArray; w: number; h: number } {
  const grade: Cor[][] = []
  for (let y = 0; y < h; y++) {
    const linha: Cor[] = []
    for (let x = 0; x < w; x++) linha.push(y === Math.floor(h / 2) && x > 2 && x < w - 3 ? tinta : fundo)
    grade.push(linha)
  }
  return pixels(grade)
}

const BRANCO: Cor = [255, 255, 255]
const TINTA: Cor = [30, 30, 70]
const alfaEm = (d: Uint8ClampedArray, i: number) => d[i * 4 + 3]

describe('classesDeBrilho', () => {
  it('separa os dois grupos de brilho da imagem', () => {
    const hist = new Array<number>(256).fill(0)
    hist[40] = 100 // tinta
    hist[230] = 900 // papel
    const c = classesDeBrilho(hist, 1000)
    expect(c.tinta).toBeCloseTo(40, 0)
    expect(c.fundo).toBeCloseTo(230, 0)
  })

  it('escuro é SEMPRE tinta e claro é SEMPRE papel', () => {
    // Assinatura é traço escuro em papel claro, nunca o contrário. Inverter faria o
    // certificado sair com o papel opaco e a assinatura transparente.
    const hist = new Array<number>(256).fill(0)
    hist[20] = 950 // muita tinta (rubrica cheia)
    hist[240] = 50
    const c = classesDeBrilho(hist, 1000)
    expect(c.tinta).toBeLessThan(c.fundo)
  })
})

describe('fundoParaAlfa', () => {
  it('papel vira transparente e traço vira opaco', () => {
    const { data, w, h } = scan(BRANCO, TINTA)
    fundoParaAlfa(data, w, h)
    expect(alfaEm(data, 0)).toBe(0) // canto = papel
    expect(alfaEm(data, Math.floor(h / 2) * w + Math.floor(w / 2))).toBe(255) // meio = traço
  })

  it('TINTA ESCURA E APERTADA sai 100% opaca, não fantasma', () => {
    // Bug real: calibrando a rampa pelo LIMIAR, a tinta ficava logo abaixo dele, no topo
    // da rampa, e saía com ~11% de opacidade — assinatura quase invisível no diploma.
    // Calibrar pelas MÉDIAS das classes é o que conserta.
    const { data, w, h } = scan(BRANCO, [26, 26, 58])
    fundoParaAlfa(data, w, h)
    expect(alfaEm(data, Math.floor(h / 2) * w + Math.floor(w / 2))).toBe(255)
  })

  it('SCAN SUJO: papel cinza com sombra continua transparente', () => {
    // Um corte fixo em 240 marcava 29% da imagem como traço num scan com sombra e textura.
    const w = 30
    const h = 12
    const grade: Cor[][] = []
    for (let y = 0; y < h; y++) {
      const linha: Cor[] = []
      for (let x = 0; x < w; x++) {
        // papel cinza (250) escurecendo até 232 do outro lado — sombra do scanner
        const p = 250 - Math.round((18 * x) / w)
        linha.push(y === 6 && x > 3 && x < w - 4 ? TINTA : [p, p, p])
      }
      grade.push(linha)
    }
    const { data } = pixels(grade)
    const r = fundoParaAlfa(data, w, h)
    expect(alfaEm(data, 0)).toBe(0) // lado claro
    expect(alfaEm(data, w - 1)).toBe(0) // lado com sombra: TAMBÉM transparente
    expect(r.opacos / (w * h)).toBeLessThan(0.2)
  })

  it('o meio-tom vira SEMItransparente — é o que mantém a borda do traço suave', () => {
    const grade: Cor[][] = [
      [BRANCO, BRANCO, BRANCO, BRANCO, BRANCO],
      [BRANCO, [140, 140, 150], TINTA, [140, 140, 150], BRANCO],
      [BRANCO, BRANCO, BRANCO, BRANCO, BRANCO],
    ]
    const { data, w, h } = pixels(grade)
    fundoParaAlfa(data, w, h)
    const borda = alfaEm(data, w + 1)
    expect(borda).toBeGreaterThan(0)
    expect(borda).toBeLessThan(255)
  })

  it('a COR do traço é preservada, só o alfa muda', () => {
    // Zerar o RGB junto clarearia a assinatura ao compor sobre o certificado.
    const { data, w, h } = scan(BRANCO, TINTA)
    fundoParaAlfa(data, w, h)
    const i = (Math.floor(h / 2) * w + Math.floor(w / 2)) * 4
    expect([data[i], data[i + 1], data[i + 2]]).toEqual([30, 30, 70])
  })

  it('o recorte envolve só o traço, ignorando a sobra de papel', () => {
    // Sem recortar, o object-fit do template ajusta pela imagem INTEIRA e a assinatura
    // sai pequena demais dentro da caixa.
    const { data, w, h } = scan(BRANCO, TINTA, 20, 9)
    const r = fundoParaAlfa(data, w, h)
    expect(r.recorte).toEqual({ x: 3, y: 4, w: 14, h: 1 })
  })

  it('imagem toda branca não tem recorte e não quebra', () => {
    const { data, w, h } = pixels([
      [BRANCO, BRANCO],
      [BRANCO, BRANCO],
    ])
    const r = fundoParaAlfa(data, w, h)
    expect(r.recorte).toBeNull()
    expect(r.opacos).toBe(0)
  })

  it('pixel já transparente é deixado em paz e não entra no histograma', () => {
    // PNG que já veio limpo não pode ser reprocessado a ponto de mudar.
    const { data, w, h } = scan(BRANCO, TINTA)
    data[3] = 0
    fundoParaAlfa(data, w, h)
    expect(alfaEm(data, 0)).toBe(0)
  })
})

describe('avisoDoResultado', () => {
  it('nada sobrou → avisa que a imagem é clara demais', () => {
    expect(avisoDoResultado({ recorte: null, opacos: 0 }, 100)).toMatch(/clara demais/)
  })

  it('mais da metade virou traço → avisa que o fundo não era branco', () => {
    expect(avisoDoResultado({ recorte: { x: 0, y: 0, w: 10, h: 10 }, opacos: 60 }, 100)).toMatch(/não era branco/)
  })

  it('resultado plausível → sem aviso', () => {
    expect(avisoDoResultado({ recorte: { x: 0, y: 0, w: 10, h: 10 }, opacos: 5 }, 100)).toBeNull()
  })
})
