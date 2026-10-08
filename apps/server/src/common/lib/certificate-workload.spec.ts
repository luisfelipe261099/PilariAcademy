import { certificateWorkloadHours } from './certificate-workload'

describe('certificateWorkloadHours', () => {
  it('a carga declarada no curso vence a soma da duração das aulas', () => {
    // 180h de curso não são 180h de aula gravada: a carga declarada é outra coisa.
    expect(certificateWorkloadHours(180, 7200)).toBe(180)
  })

  it('sem carga declarada, soma as aulas e arredonda para a hora mais próxima', () => {
    expect(certificateWorkloadHours(null, 7200)).toBe(2)
    expect(certificateWorkloadHours(undefined, 7200)).toBe(2)
    expect(certificateWorkloadHours(null, 12960)).toBe(4) // 3,6 h sobe
    expect(certificateWorkloadHours(null, 12240)).toBe(3) // 3,4 h desce
    expect(certificateWorkloadHours(null, 5400)).toBe(2) // 1,5 h arredonda para cima
  })

  it('carga declarada zero ou negativa não vale: cai na soma, como no certificado', () => {
    expect(certificateWorkloadHours(0, 7200)).toBe(2)
    expect(certificateWorkloadHours(-5, 7200)).toBe(2)
  })

  it('nunca devolve 0 hora', () => {
    // Curso sem duração cadastrada arredondaria para zero, e "0 horas" no diploma é pior que um
    // arredondado para cima.
    expect(certificateWorkloadHours(null, 60)).toBe(1)
    expect(certificateWorkloadHours(null, 0)).toBe(1)
    expect(certificateWorkloadHours(0, 0)).toBe(1)
  })
})
