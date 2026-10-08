/** Teto do material de um módulo no contexto do tutor (~15 mil tokens): limita o custo de cada pergunta. */
export const TETO_MATERIAL_CHARS = 60_000

/**
 * Limpa o texto extraído de um PDF para virar material do tutor: tira os marcadores de página do extrator
 * ("-- 3 of 15 --"), os rodapés com numeração ("3 / 15  Curso · Módulo"), linhas repetidas em todas as páginas e
 * espaços sobrando. O conteúdo em si não muda.
 */
export function limparTextoPdf(texto: string): string {
  const linhas = texto.replace(/\r/g, '').split('\n').map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
  const contagem = new Map<string, number>()
  for (const l of linhas) if (l) contagem.set(l, (contagem.get(l) ?? 0) + 1)
  const paginas = linhas.filter((l) => /^-- \d+ of \d+ --$/.test(l)).length
  const repetidaEmToda = (l: string): boolean => paginas >= 3 && l.length < 120 && (contagem.get(l) ?? 0) >= paginas - 1

  const saida: string[] = []
  for (const l of linhas) {
    if (/^-- \d+ of \d+ --$/.test(l)) continue
    if (/^\d+ \/ \d+(\s.*)?$/.test(l)) continue
    if (repetidaEmToda(l)) continue
    if (!l) {
      if (saida.length && saida[saida.length - 1] !== '') saida.push('')
      continue
    }
    saida.push(l)
  }
  return saida.join('\n').trim()
}

/** Junta os textos dos PDFs de um módulo, com o nome de cada arquivo, e corta no teto sem partir uma linha no meio. */
export function montarMaterial(fontes: ReadonlyArray<{ nome: string; texto: string }>, teto = TETO_MATERIAL_CHARS): string {
  let saida = ''
  for (const f of fontes) {
    const bloco = `### ${f.nome}\n${f.texto}\n\n`
    if (saida.length + bloco.length <= teto) {
      saida += bloco
      continue
    }
    const resto = teto - saida.length
    if (resto > 200) {
      const corte = bloco.slice(0, resto)
      saida += corte.slice(0, Math.max(corte.lastIndexOf('\n'), 0))
    }
    break
  }
  return saida.trim()
}
