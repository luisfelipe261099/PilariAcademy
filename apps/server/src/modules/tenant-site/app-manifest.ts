/**
 * Manifesto do app (PWA) de cada polo: nome, cor e ícone vêm da marca do polo do endereço, então o aluno instala
 * o app do PRÓPRIO polo. Puro: sem rede e sem banco.
 */

export const VARIANTES_ICONE = ['any-192', 'any-512', 'maskable-512', 'apple-180'] as const
export type VarianteIcone = (typeof VARIANTES_ICONE)[number]

export function ehVarianteIcone(v: string): v is VarianteIcone {
  return (VARIANTES_ICONE as readonly string[]).includes(v)
}

/** Medidas de cada ícone: `escala` é o tamanho da marca no quadrado e `raio` arredonda o fundo (0 = quadrado cheio). */
export const MEDIDAS_ICONE: Record<VarianteIcone, { lado: number; escala: number; raio: number }> = {
  'any-192': { lado: 192, escala: 0.7, raio: 0.22 },
  'any-512': { lado: 512, escala: 0.7, raio: 0.22 },
  // O Android recorta o maskable em círculo, gota ou quadrado: a marca precisa caber no círculo central de 80%.
  'maskable-512': { lado: 512, escala: 0.56, raio: 0 },
  // O iPhone arredonda sozinho e pinta de preto o que for transparente: fundo cheio.
  'apple-180': { lado: 180, escala: 0.7, raio: 0 },
}

/** Ícones fixos do símbolo do Studio Pilari (apps/client/public/icons), usados pela matriz. */
export const ICONES_DA_MATRIZ: Record<VarianteIcone, string> = {
  'any-192': '/icons/pilari-192.png',
  'any-512': '/icons/pilari-512.png',
  'maskable-512': '/icons/pilari-maskable-512.png',
  'apple-180': '/icons/pilari-apple-180.png',
}

const TETO_NOME_CURTO = 12

/** Palavras que abrem o nome de muito polo e não o distinguem: "Instituto Horizonte" vira "Horizonte". */
const GENERICAS = /^(polo|instituto|escola|centro|col[eé]gio|faculdade|grupo|academia|unidade|n[uú]cleo)\s+((d[aeo]s?)\s+)?/i

/**
 * Nome embaixo do ícone na tela inicial: o Android corta por volta de 12 caracteres. Sem a palavra genérica do
 * começo, fica com as palavras inteiras que cabem; se nem a primeira cabe, corta a primeira.
 */
export function nomeCurtoDoApp(nome: string): string {
  const inteiro = nome.trim().replace(/\s+/g, ' ')
  if (inteiro.length <= TETO_NOME_CURTO) return inteiro
  const limpo = inteiro.replace(GENERICAS, '') || inteiro
  if (limpo.length <= TETO_NOME_CURTO) return limpo
  let curto = ''
  for (const palavra of limpo.split(' ')) {
    const proximo = curto ? `${curto} ${palavra}` : palavra
    if (proximo.length > TETO_NOME_CURTO) break
    curto = proximo
  }
  return curto || limpo.slice(0, TETO_NOME_CURTO)
}

interface PoloDoManifesto {
  name: string
  isMatriz: boolean
  branding: { primaryColor: string; description: string | null }
}

export function montarManifesto(polo: PoloDoManifesto, versao: string): Record<string, unknown> {
  const icone = (v: VarianteIcone, purpose: 'any' | 'maskable') => {
    const { lado } = MEDIDAS_ICONE[v]
    const src = polo.isMatriz ? ICONES_DA_MATRIZ[v] : `/api/tenant/app-icon/${v}?v=${encodeURIComponent(versao)}`
    return { src, sizes: `${lado}x${lado}`, type: 'image/png', purpose }
  }
  return {
    id: '/',
    name: polo.isMatriz ? 'Studio Pilari Cursos' : polo.name,
    short_name: polo.isMatriz ? 'Studio Pilari' : nomeCurtoDoApp(polo.name),
    description: polo.branding.description ?? 'Seus cursos, aulas, provas e certificados no celular.',
    lang: 'pt-BR',
    dir: 'ltr',
    // Abre direto na área do aluno; sem sessão, a rota protegida leva ao login e volta para cá.
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: polo.branding.primaryColor,
    categories: ['education'],
    icons: [icone('any-192', 'any'), icone('any-512', 'any'), icone('maskable-512', 'maskable')],
  }
}

/**
 * SVG no tamanho do ícone: o rasterizador desenha o SVG no width/height da tag raiz, e uma logo com width="40"
 * sairia borrada. Troca as medidas da raiz pelo lado pedido e garante um viewBox para a escala funcionar.
 */
export function svgNoTamanho(svg: string, lado: number): string {
  const raiz = svg.match(/<svg\b[^>]*>/i)
  if (!raiz) return svg
  const tag = raiz[0]
  const numero = (attr: string) => {
    const m = tag.match(new RegExp(`\\s${attr}\\s*=\\s*["']\\s*([\\d.]+)(?:px)?\\s*["']`, 'i'))
    return m ? Number(m[1]) : null
  }
  let nova = tag.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, '')
  if (!/\sviewBox\s*=/i.test(nova)) {
    const w = numero('width')
    const h = numero('height')
    if (w && h) nova = nova.replace(/^<svg\b/i, `<svg viewBox="0 0 ${w} ${h}"`)
  }
  nova = nova.replace(/^<svg\b/i, `<svg width="${lado}" height="${lado}"`)
  return svg.replace(tag, nova)
}

/** A inicial do nome do polo (letra ou dígito, nunca meio emoji), como no favicon de reserva. */
export function inicialDoPolo(nome: string): string {
  return (nome.match(/[\p{L}\p{N}]/u)?.[0] ?? 'P').toUpperCase()
}
