import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderizarTemplate } from './local-pdf'

// A impressão no Chromium (imprimirPdf) não roda no Jest: o puppeteer-core é ESM puro e o Jest daqui é CommonJS.
// Ela é conferida de ponta a ponta com tsx (como roda em produção) e no deploy.

describe('renderizarTemplate', () => {
  it('troca variáveis e escapa o valor', () => {
    expect(renderizarTemplate('<b>{{ nome }}</b>', { nome: 'Ana <script>' })).toBe('<b>Ana &lt;script&gt;</b>')
  })
  it('variável ausente vira vazio', () => {
    expect(renderizarTemplate('[{{ x }}]', {})).toBe('[]')
  })
  it('if, else e aninhamento', () => {
    const t = '{% if a %}A{% if b %}B{% else %}nb{% endif %}{% else %}na{% endif %}'
    expect(renderizarTemplate(t, { a: '1', b: '1' })).toBe('AB')
    expect(renderizarTemplate(t, { a: '1', b: '' })).toBe('Anb')
    expect(renderizarTemplate(t, { a: '', b: '1' })).toBe('na')
  })
  it('remove comentários', () => {
    expect(renderizarTemplate('a{# nada {{ x }} aqui #}b', { x: 'X' })).toBe('ab')
  })
  it('recusa o que não suporta, em vez de imprimir errado', () => {
    expect(() => renderizarTemplate('{{ x | upper }}', {})).toThrow('não suportada')
    expect(() => renderizarTemplate('{% for i in x %}{% endfor %}', {})).toThrow('não suportada')
    expect(() => renderizarTemplate('{% if a %}sem fim', {})).toThrow('sem {% endif %}')
    expect(() => renderizarTemplate('{% endif %}', {})).toThrow('sem {% if %}')
  })
  it('o template de fábrica renderiza sem sobrar marcação', () => {
    const html = readFileSync(join(__dirname, 'assets', 'certificate.html'), 'utf8')
    const out = renderizarTemplate(html, { studentName: 'Ana Paula', cpf: '000.000.000-00', courseTitle: 'Pilates', hours: '20', code: 'ABC', issuedAtBr: '08/10/2026', verifyUrl: 'https://x/c/ABC' })
    expect(out).toContain('Ana Paula')
    expect(out).toContain('CPF sob nº 000.000.000-00')
    expect(out).not.toMatch(/\{\{|\{%/)
  })
})
