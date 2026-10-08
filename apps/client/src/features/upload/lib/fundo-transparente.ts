/**
 * Tira o fundo branco de uma assinatura escaneada.
 *
 * A rubrica é impressa POR CIMA da linha do certificado. Um PNG com fundo branco desenha
 * um retângulo que corta o traço, e é o erro que todo scan de papel comete — por isso a
 * limpeza acontece sozinha no upload, em vez de depender de o admin mandar o arquivo certo.
 */

/**
 * Limiar entre papel e tinta, calculado PELA PRÓPRIA IMAGEM (método de Otsu).
 *
 * Um corte fixo não sobrevive a um scan real: papel levemente cinza, sombra de um lado e
 * textura ficam abaixo de qualquer "branco" fixo e viram tinta. Num teste com sombra e
 * ruído, o corte fixo marcou 29% da imagem como traço. Otsu procura o valor que melhor
 * separa os dois grupos de brilho da imagem — e num scan de assinatura eles são bem
 * separados (papel ~230, tinta ~45).
 */
export interface Classes {
  /** Brilho médio do papel. */
  fundo: number
  /** Brilho médio da tinta. */
  tinta: number
}

/**
 * Separa papel de tinta pelo brilho, calculando o corte PELA PRÓPRIA IMAGEM (Otsu).
 *
 * Um corte fixo não sobrevive a um scan real: papel levemente cinza, sombra de um lado e
 * textura ficam abaixo de qualquer "branco" fixo e viram tinta — num teste com sombra e
 * ruído, o corte fixo marcou 29% da imagem como traço, contra 3,4% aqui.
 *
 * Devolve as MÉDIAS das duas classes, não o limiar. O limiar sozinho não serve para montar
 * a rampa de transparência: quando a tinta é um grupo apertado e escuro, Otsu devolve um
 * corte logo acima dela, e uma rampa que começasse ali deixaria o traço com ~11% de
 * opacidade — assinatura praticamente invisível. Entre as duas médias a rampa fica certa
 * em qualquer imagem.
 */
export function classesDeBrilho(histograma: number[], total: number): Classes {
  let somaTotal = 0
  for (let i = 0; i < 256; i++) somaTotal += i * histograma[i]

  let somaAbaixo = 0
  let pesoAbaixo = 0
  let melhorVariancia = -1
  let melhor: Classes = { fundo: 255, tinta: 0 }

  for (let t = 0; t < 256; t++) {
    pesoAbaixo += histograma[t]
    if (pesoAbaixo === 0) continue
    const pesoAcima = total - pesoAbaixo
    if (pesoAcima === 0) break

    somaAbaixo += t * histograma[t]
    const mediaAbaixo = somaAbaixo / pesoAbaixo
    const mediaAcima = (somaTotal - somaAbaixo) / pesoAcima
    // Variância ENTRE as classes: o corte que a maximiza é o que melhor separa as duas.
    const variancia = pesoAbaixo * pesoAcima * (mediaAbaixo - mediaAcima) ** 2
    if (variancia > melhorVariancia) {
      melhorVariancia = variancia
      // Escuro é tinta, claro é papel — assinatura em papel, nunca o contrário.
      melhor = { tinta: mediaAbaixo, fundo: mediaAcima }
    }
  }
  return melhor
}

/**
 * Quanto a rampa recua de cada média em direção ao meio. Sem essa folga, papel exatamente
 * na média do fundo já sairia levemente opaco e a sombra do scan apareceria como véu.
 */
const FOLGA = 0.15

export interface Recorte {
  x: number
  y: number
  w: number
  h: number
}

export interface ResultadoFundo {
  /** Caixa que envolve o que sobrou, ou null se não sobrou nada. */
  recorte: Recorte | null
  /** Quantos pixels ficaram visíveis. Serve para detectar um resultado absurdo. */
  opacos: number
}

/**
 * Converte brilho em transparência, NO LUGAR (mesma semântica do ImageData do canvas).
 *
 * Não é "apaga o que for branco": o traço da caneta tem antialiasing, então o pixel da
 * borda é cinza-claro. Cortar tudo que não é escuro deixaria a assinatura serrilhada e
 * obviamente recortada. Aqui o meio-tom vira semitransparente e a borda continua suave.
 */
export function fundoParaAlfa(data: Uint8ClampedArray, largura: number, altura: number): ResultadoFundo {
  // 1ª passada: histograma de luminância, para o limiar sair da própria imagem.
  const histograma = new Array<number>(256).fill(0)
  let considerados = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    histograma[Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])]++
    considerados++
  }
  const { fundo, tinta } = classesDeBrilho(histograma, considerados)
  const faixa = fundo - tinta
  const BRANCO = fundo - FOLGA * faixa
  const PRETO = tinta + FOLGA * faixa

  let opacos = 0
  let minX = largura
  let minY = altura
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const i = (y * largura + x) * 4
      if (data[i + 3] === 0) continue
      // Luminância perceptual: um traço azul-escuro é mais escuro para o olho do que a
      // média aritmética sugere, e a média deixaria tinta azul clara demais.
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]

      let alfa: number
      if (lum >= BRANCO) alfa = 0
      else if (lum <= PRETO) alfa = 255
      else alfa = Math.round((255 * (BRANCO - lum)) / (BRANCO - PRETO))

      data[i + 3] = alfa
      if (alfa > 0) {
        opacos++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  const recorte = maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
  return { recorte, opacos }
}

/**
 * Recado para o admin quando o resultado é absurdo. `null` = deu certo.
 *
 * Vale avisar em vez de recusar: quem decide se a assinatura ficou boa é quem está olhando
 * para ela, e um alerta que bloqueia o upload seria pior do que um que só adverte.
 */
export function avisoDoResultado(r: ResultadoFundo, totalPixels: number): string | null {
  if (r.opacos === 0) {
    return 'A imagem ficou vazia — ela é clara demais. Confira o arquivo ou envie um PNG já transparente.'
  }
  if (r.opacos / totalPixels > 0.5) {
    return 'Mais da metade da imagem virou traço: o fundo provavelmente não era branco. Confira o preview.'
  }
  return null
}
