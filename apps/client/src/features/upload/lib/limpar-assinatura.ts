import { avisoDoResultado, fundoParaAlfa, type Recorte } from './fundo-transparente'

export interface AssinaturaLimpa {
  arquivo: File
  /** Recado quando o resultado ficou estranho. null = ok. */
  aviso: string | null
}

/** Segurança: um arquivo enorme travaria a aba no laço por pixel. */
const LADO_MAXIMO = 2000

function desenhar(img: HTMLImageElement): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  // Reduz antes de processar: o laço é por pixel, e um scan de 4000px levaria segundos
  // com a aba travada. 2000px de lado é muito mais do que a caixa do certificado usa.
  const escala = Math.min(1, LADO_MAXIMO / Math.max(img.naturalWidth, img.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.naturalWidth * escala)
  canvas.height = Math.round(img.naturalHeight * escala)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas indisponível neste navegador.')
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return { canvas, ctx }
}

function recortar(origem: HTMLCanvasElement, r: Recorte): HTMLCanvasElement {
  const destino = document.createElement('canvas')
  destino.width = r.w
  destino.height = r.h
  const ctx = destino.getContext('2d')
  if (!ctx) throw new Error('Canvas indisponível neste navegador.')
  ctx.drawImage(origem, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h)
  return destino
}

function carregar(arquivo: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(arquivo)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Não foi possível ler a imagem.'))
    }
    img.src = url
  })
}

function paraBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao gerar o PNG.'))), 'image/png')
  })
}

/**
 * Recebe a assinatura como o coordenador mandou (JPG de scan, print, PNG com fundo) e
 * devolve um PNG transparente e recortado, pronto para ir ao certificado.
 *
 * Roda no NAVEGADOR de propósito: fazer no servidor exigiria uma lib nativa de imagem
 * (~30MB no container) para uma transformação cosmética, e o admin não veria o resultado
 * antes de salvar. Aqui o preview mostra exatamente o que será gravado.
 */
export async function limparAssinatura(arquivo: File): Promise<AssinaturaLimpa> {
  const img = await carregar(arquivo)
  const { canvas, ctx } = desenhar(img)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

  const resultado = fundoParaAlfa(imageData.data, canvas.width, canvas.height)
  const aviso = avisoDoResultado(resultado, canvas.width * canvas.height)
  ctx.putImageData(imageData, 0, 0)

  // Sem recorte não há o que cortar; devolve o quadro inteiro em vez de falhar.
  const final = resultado.recorte ? recortar(canvas, resultado.recorte) : canvas
  const blob = await paraBlob(final)
  // Sempre .png: o arquivo de origem pode ser JPG, que não tem canal alfa — manter o nome
  // original faria o GCS guardar um content-type que não corresponde aos bytes.
  const nome = arquivo.name.replace(/\.[^.]+$/, '') + '.png'
  return { arquivo: new File([blob], nome, { type: 'image/png' }), aviso }
}
