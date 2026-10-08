import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * O banco de produção é TiDB (compatível com MySQL 8), que recusa `timestamp(3) DEFAULT (now())`: o padrão precisa ter
 * a mesma precisão da coluna, `now(3)`. O drizzle-kit gera `(now())` para `.defaultNow()`, então toda migration nova
 * precisa da troca — este teste pega antes do deploy (o erro só apareceria no boot em produção).
 */
describe('migrations compatíveis com o TiDB', () => {
  const pasta = join(__dirname, '..', '..', 'drizzle')
  const arquivos = readdirSync(pasta).filter((f) => f.endsWith('.sql'))

  it('existem migrations para conferir', () => {
    expect(arquivos.length).toBeGreaterThan(0)
  })

  it.each(arquivos)('%s: timestamp com fração de segundo usa now() com a mesma precisão', (arquivo) => {
    const sql = readFileSync(join(pasta, arquivo), 'utf8')
    const errados = [...sql.matchAll(/timestamp\((\d)\)[^,\n]*DEFAULT \(now\((\d?)\)\)/gi)].filter(([, col, def]) => col !== (def || '0'))
    expect(errados.map(([trecho]) => trecho)).toEqual([])
  })
})
