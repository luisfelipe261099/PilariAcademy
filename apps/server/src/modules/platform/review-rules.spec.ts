/// <reference types="jest" />
import { auditNote, reviewFingerprint, type ReviewFingerprintInput } from './review-rules'

const curso: ReviewFingerprintInput = {
  title: 'Excel Básico', workloadHours: 40, coordinatorName: 'Ana Souza', coordinatorRole: 'Coordenadora', coordinatorSignaturePath: 'cursos/c1/signature/ana.png',
}

describe('reviewFingerprint', () => {
  it('16 caracteres hexadecimais, sempre os mesmos para o mesmo curso', () => {
    expect(reviewFingerprint(curso)).toMatch(/^[0-9a-f]{16}$/)
    expect(reviewFingerprint({ ...curso })).toBe(reviewFingerprint(curso))
  })

  it.each([
    ['o título', { title: 'Excel Avançado' }],
    ['a carga', { workloadHours: 41 }],
    ['o coordenador', { coordinatorName: 'Beto Lima' }],
    ['o cargo', { coordinatorRole: 'Diretor' }],
    ['a assinatura', { coordinatorSignaturePath: 'cursos/c1/signature/outra.png' }],
    ['tirar o coordenador', { coordinatorName: null }],
  ])('muda quando muda %s', (_oQue, mudanca) => {
    expect(reviewFingerprint({ ...curso, ...mudanca })).not.toBe(reviewFingerprint(curso))
  })

  it('campos com a barra não empatam com outra divisão dos campos', () => {
    const a = reviewFingerprint({ ...curso, title: 'Excel|Ana', coordinatorName: '' })
    const b = reviewFingerprint({ ...curso, title: 'Excel', coordinatorName: 'Ana' })
    expect(a).not.toBe(b)
  })
})

describe('auditNote', () => {
  it('nota curta vai inteira, numa linha só e sem espaços nas pontas', () => {
    expect(auditNote('  A aula 1\n está   sem áudio.  ')).toBe('A aula 1 está sem áudio.')
  })

  it('até 200 caracteres não corta', () => {
    expect(auditNote('a'.repeat(200))).toBe('a'.repeat(200))
  })

  it('acima de 200 corta com reticências, sem passar de 200', () => {
    const r = auditNote('a'.repeat(1000))
    expect(r).toBe(`${'a'.repeat(199)}…`)
    expect(r.length).toBe(200)
    // o corte não deixa espaço antes das reticências
    expect(auditNote(`${'a'.repeat(198)} bbbbb`)).toBe(`${'a'.repeat(198)}…`)
  })
})
