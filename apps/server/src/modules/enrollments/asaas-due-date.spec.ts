/// <reference types="jest" />
import { BadRequestException } from '@nestjs/common'
import { resolveDueDate } from './asaas.service'

const hoje = () => new Date().toISOString().slice(0, 10)
const emDias = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

describe('resolveDueDate', () => {
  it('sem data → 3 dias, que é o padrão do checkout do aluno', () => {
    expect(resolveDueDate()).toBe(emDias(3))
    expect(resolveDueDate(null)).toBe(emDias(3))
  })

  it('data informada vence o padrão', () => {
    expect(resolveDueDate(emDias(30))).toBe(emDias(30))
  })

  it('HOJE é aceito — boleto do dia é legítimo', () => {
    expect(resolveDueDate(hoje())).toBe(hoje())
  })

  it('data no PASSADO é recusada aqui, não no Asaas', () => {
    // Um boleto vencido nasce impagável, e o erro de lá voltaria como 400 opaco sem dizer
    // qual campo estava errado.
    expect(() => resolveDueDate(emDias(-1))).toThrow(BadRequestException)
    expect(() => resolveDueDate('2020-01-01')).toThrow(BadRequestException)
  })
})
