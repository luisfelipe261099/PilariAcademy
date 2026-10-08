/// <reference types="jest" />
import 'reflect-metadata'
import { BadRequestException } from '@nestjs/common'
import { IsString } from 'class-validator'
import { PtBrValidationPipe, traduzirMensagemDeValidacao } from './validation-pipe'

class Corpo {
  @IsString({ message: 'Informe o nome.' }) nome!: string
}

describe('traduzirMensagemDeValidacao (B5)', () => {
  it('campo fora do DTO vira "O campo X não é aceito."', () => {
    expect(traduzirMensagemDeValidacao('property tenantId should not exist')).toBe('O campo tenantId não é aceito.')
  })
  it('em objeto aninhado, o caminho que o Nest põe na frente entra no nome do campo', () => {
    expect(traduzirMensagemDeValidacao('branding.property cor should not exist')).toBe('O campo branding.cor não é aceito.')
  })
  it('as mensagens que os DTOs declaram passam como estão', () => {
    expect(traduzirMensagemDeValidacao('Informe o nome.')).toBe('Informe o nome.')
    expect(traduzirMensagemDeValidacao('O campo x não é aceito.')).toBe('O campo x não é aceito.')
  })
})

describe('PtBrValidationPipe: o formato de sempre (400 com a lista de mensagens), em português', () => {
  const pipe = new PtBrValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
  const validar = (corpo: object) => pipe.transform(corpo, { type: 'body', metatype: Corpo })

  it('campo a mais', async () => {
    const erro = await validar({ nome: 'Ana', tenantId: 'outro-polo' }).catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(BadRequestException)
    expect((erro as BadRequestException).getResponse()).toEqual({ statusCode: 400, error: 'Bad Request', message: ['O campo tenantId não é aceito.'] })
  })
  it('junto com a mensagem do DTO, na ordem dos campos', async () => {
    const erro = (await validar({ extra: 1 }).catch((e: unknown) => e)) as BadRequestException
    expect((erro.getResponse() as { message: string[] }).message.sort()).toEqual(['Informe o nome.', 'O campo extra não é aceito.'])
  })
  it('corpo válido passa transformado', async () => {
    expect(await validar({ nome: 'Ana' })).toBeInstanceOf(Corpo)
  })
})
