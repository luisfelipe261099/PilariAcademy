import { existsSync } from 'node:fs'

/**
 * Renderização local do certificado (HTML → Chromium → PDF), usada quando não há pdfSynth (PDF_SYNTH_URL vazio): o
 * container da Vercel traz o Chromium do sistema. O template usa o subconjunto do Tera que o editor e o modelo de
 * fábrica produzem: `{{ variavel }}`, `{% if variavel %}…{% else %}…{% endif %}` e comentários `{# … #}`.
 */

const escapar = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const NOME = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Aplica os dados ao template. Valores são escapados (como o autoescape do Tera em .html). Tag desconhecida lança. */
export function renderizarTemplate(template: string, dados: Record<string, string>): string {
  const pedacos = template.replace(/\{#[\s\S]*?#\}/g, '').split(/(\{%[\s\S]*?%\}|\{\{[\s\S]*?\}\})/)
  // Pilha de condicionais: cada nível diz se o ramo atual está ativo (e se o pai está).
  const pilha: Array<{ pai: boolean; condicao: boolean; noElse: boolean }> = []
  const ativo = (): boolean => (pilha.length ? pilha[pilha.length - 1].pai && (pilha[pilha.length - 1].noElse ? !pilha[pilha.length - 1].condicao : pilha[pilha.length - 1].condicao) : true)
  let saida = ''
  for (const p of pedacos) {
    if (p.startsWith('{{')) {
      const nome = p.slice(2, -2).trim()
      if (!NOME.test(nome)) throw new Error(`Expressão não suportada no template: ${p}`)
      if (ativo()) saida += escapar(dados[nome] ?? '')
    } else if (p.startsWith('{%')) {
      const tag = p.slice(2, -2).trim()
      const se = /^if\s+([A-Za-z_][A-Za-z0-9_]*)$/.exec(tag)
      if (se) pilha.push({ pai: ativo(), condicao: !!dados[se[1]], noElse: false })
      else if (tag === 'else') {
        const topo = pilha[pilha.length - 1]
        if (!topo || topo.noElse) throw new Error('{% else %} sem {% if %} correspondente')
        topo.noElse = true
      } else if (tag === 'endif') {
        if (!pilha.pop()) throw new Error('{% endif %} sem {% if %} correspondente')
      } else throw new Error(`Tag não suportada no template: ${p}`)
    } else if (ativo()) saida += p
  }
  if (pilha.length) throw new Error('{% if %} sem {% endif %}')
  return saida
}

/** Executável do Chromium: CHROMIUM_PATH ou os caminhos usuais do Debian/Ubuntu. `null` se não houver. */
export function encontrarChromium(env: string | undefined): string | null {
  const candidatos = [env, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].filter(Boolean) as string[]
  return candidatos.find((c) => existsSync(c)) ?? null
}

/**
 * Imprime o HTML em PDF com o Chromium. Rede bloqueada: só `data:` e o documento em si passam (o template já é
 * validado antes, isto é a última linha). O tamanho e a orientação vêm do `@page` do template.
 */
export async function imprimirPdf(html: string, executavel: string, timeoutMs: number): Promise<Buffer> {
  const { launch } = await import('puppeteer-core')
  const browser = await launch({
    executablePath: executavel,
    headless: true,
    // No container não há namespaces de usuário para o sandbox do Chromium; /dev/shm é pequeno.
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none'],
  })
  try {
    const page = await browser.newPage()
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      const url = req.url()
      if (url.startsWith('data:') || url === 'about:blank') void req.continue()
      else void req.abort('blockedbyclient')
    })
    await page.setContent(html, { waitUntil: 'load', timeout: timeoutMs })
    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true, timeout: timeoutMs })
    return Buffer.from(pdf)
  } finally {
    await browser.close()
  }
}
