/// <reference types="jest" />
import { maskCpf } from './cpf'

describe('maskCpf (a mesma máscara do documento público do certificado)', () => {
  it('CPF de 11 dígitos, com ou sem pontuação, vira a máscara inteira: nenhum dígito aparece', () => {
    expect(maskCpf('52998224725')).toBe('***.***.***-**')
    expect(maskCpf('529.982.247-25')).toBe('***.***.***-**')
  })
  it('vazio, nulo ou fora do formato não vira máscara (nada a esconder nem a mostrar)', () => {
    expect(maskCpf(null)).toBe('')
    expect(maskCpf(undefined)).toBe('')
    expect(maskCpf('')).toBe('')
    expect(maskCpf('123')).toBe('')
  })
})
