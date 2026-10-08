/**
 * Defesas contra o navegador tratar conteúdo enviado pelo usuário como HTML/script ativo
 * na MESMA origem do app. O upload grava o `content-type` que o cliente escolheu no metadado
 * do objeto no GCS; se um proxy do app refletir esse tipo com disposição `inline`, um arquivo
 * `text/html` (ou SVG) vira Stored XSS na origem confiável. As funções aqui garantem que o app
 * só sirva `inline` tipos comprovadamente inertes.
 */

/** Assinatura de arquivo PDF (%PDF-) — todo PDF válido começa com estes 5 bytes. */
const PDF_SIGNATURE = Buffer.from('%PDF-')
/** Quantos bytes do começo do arquivo bastam para `looksLikePdf` decidir (o download de intervalo do proxy). */
export const PDF_SIGNATURE_LENGTH = PDF_SIGNATURE.length

/** Imagens raster que o navegador renderiza sem executar script. SVG fica DE FORA de propósito. */
const SAFE_INLINE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif'])

/** Content-types aceitos no upload. Denylist implícita: HTML, SVG, XHTML e afins nunca entram. */
export const ALLOWED_UPLOAD_CONTENT_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
  'audio/mpeg',
  'audio/mp4',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
  'text/plain',
  'application/octet-stream',
] as const

/** true se os bytes começam com a assinatura `%PDF-`. */
export function looksLikePdf(buffer: Buffer): boolean {
  return buffer.length >= PDF_SIGNATURE.length && buffer.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE)
}

/** Normaliza um MIME: minúsculo, sem parâmetros (`; charset=...`), sem espaços. */
function normalizeMime(contentType: string | null | undefined): string {
  return (contentType ?? '').split(';')[0].trim().toLowerCase()
}

/**
 * Decide como servir uma "imagem" vinda do GCS. Tipo raster seguro → serve inline com o próprio
 * tipo; qualquer outra coisa (SVG, HTML, ausente) → `application/octet-stream` para forçar
 * download em vez de renderização — nunca executa como HTML na origem do app.
 */
export function resolveImageResponse(contentType: string | null | undefined): { contentType: string; inline: boolean } {
  const mime = normalizeMime(contentType)
  return SAFE_INLINE_IMAGE_TYPES.has(mime)
    ? { contentType: mime, inline: true }
    : { contentType: 'application/octet-stream', inline: false }
}

/**
 * Sandbox de rede do certificado (ID-10): o pdfSynth renderiza o template num Chrome COM
 * acesso à rede e sem opção de desligar o egress — qualquer subrecurso externo no HTML viraria
 * uma requisição de saída carregando dados do certificado (nome, CPF) para um host arbitrário
 * (exfiltração de PII/SSRF). Regra: o template só pode referenciar `data:` URIs.
 * Cada par [padrão, motivo] cobre um vetor: esquemas de rede, URLs relativas a protocolo em
 * atributos e em url() do CSS, e tags que carregam/redirecionam conteúdo ou executam script.
 */
const TEMPLATE_NETWORK_VIOLATIONS: Array<[RegExp, string]> = [
  [/\bhttps?:/i, 'URL http(s) — use somente data: URIs'],
  [/\b(?:ftp|ftps|ws|wss|file):/i, 'esquema de rede/arquivo — use somente data: URIs'],
  [/(?:src|href|srcset|poster|action|data|xlink:href)\s*=\s*["']?\s*\/\//i, 'URL relativa a protocolo (//host)'],
  [/url\(\s*["']?\s*\/\//i, 'url(//host) no CSS'],
  [/<script\b/i, 'tag <script> (pode montar URLs e exfiltrar via fetch)'],
  [/<(?:iframe|frame|object|embed|base|form|link)\b/i, 'tag que carrega/redireciona conteúdo externo'],
  [/<meta[^>]+http-equiv/i, '<meta http-equiv> (refresh/redirect)'],
  [/@import\b/i, '@import no CSS'],
]

/** Descrição da primeira violação de rede no template do certificado, ou null se está limpo. */
export function findTemplateNetworkViolation(html: string): string | null {
  for (const [pattern, reason] of TEMPLATE_NETWORK_VIOLATIONS) {
    if (pattern.test(html)) return reason
  }
  return null
}
