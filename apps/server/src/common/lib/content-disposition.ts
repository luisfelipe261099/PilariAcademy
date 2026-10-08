/**
 * `Content-Disposition: inline` com nome de arquivo que vem de cadastro (pode ter acento, travessão, emoji). O Node
 * recusa no cabeçalho qualquer caractere fora do Latin-1 (ERR_INVALID_CHAR → 500), então vai o par da RFC 6266:
 * `filename` em ASCII (reserva para navegador antigo) e `filename*` com o nome original em UTF-8, percent-encoded.
 */
export function dispositionInline(nome: string): string {
  const limpo = nome.replace(/["\\\r\n]/g, '').trim() || 'arquivo.pdf'
  const ascii = limpo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '-')
    .replace(/-{2,}/g, '-')
  const utf8 = encodeURIComponent(limpo).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `inline; filename="${ascii}"; filename*=UTF-8''${utf8}`
}
