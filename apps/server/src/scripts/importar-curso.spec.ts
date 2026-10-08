import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pesosDaProva, validarPacote } from './importar-curso'

describe('pesosDaProva', () => {
  it.each([1, 3, 5, 6, 7])('%i questões somam exatamente 10 pontos', (n) => {
    const pesos = pesosDaProva(n)
    expect(pesos).toHaveLength(n)
    expect(pesos.reduce((s, p) => s + Math.round(Number(p) * 100), 0)).toBe(1000)
  })
  it('6 questões: as primeiras levam o centésimo que sobra', () => {
    expect(pesosDaProva(6)).toEqual(['1.67', '1.67', '1.67', '1.67', '1.66', '1.66'])
  })
})

describe('validarPacote', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'pacote-'))
  writeFileSync(join(pasta, 'capa.jpg'), 'x')
  writeFileSync(join(pasta, 'a.pdf'), 'x')
  const base = {
    slug: 'curso', title: 'Curso', priceInCents: 100, workloadHours: 2, cover: 'capa.jpg',
    modules: [{ title: 'M1', lessons: [{ title: 'A1', minutes: 5, attachments: [{ file: 'a.pdf', name: 'A.pdf' }] }], quiz: [{ prompt: 'Q', options: ['a', 'b'], correctIndex: 1 }] }],
  }

  it('pacote completo passa', () => {
    expect(validarPacote(base, pasta)).toEqual([])
  })
  it('acusa anexo e capa que não existem', () => {
    const erros = validarPacote({ ...base, cover: 'nao.jpg', modules: [{ ...base.modules[0], lessons: [{ title: 'A1', minutes: 5, attachments: [{ file: 'x.pdf', name: 'X' }] }] }] }, pasta)
    expect(erros).toEqual(['capa: arquivo não encontrado (nao.jpg)', 'aula 1.1: arquivo não encontrado (x.pdf)'])
  })
  it('acusa gabarito fora das alternativas e módulo sem aulas', () => {
    const erros = validarPacote({ ...base, modules: [{ title: 'M1', lessons: [], quiz: [{ prompt: 'Q', options: ['a', 'b'], correctIndex: 2 }] }] }, pasta)
    expect(erros).toEqual(['módulo 1: sem aulas', 'módulo 1, questão 1: correctIndex fora das alternativas'])
  })
})
