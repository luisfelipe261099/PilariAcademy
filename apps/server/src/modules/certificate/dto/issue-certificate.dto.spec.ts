/// <reference types="jest" />
import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { IssueCertificateAsAdminDto } from './issue-certificate.dto'

// Mesmas opções do ValidationPipe global (configure-app.ts:34): o corpo é convertido antes de validar.
const CONVERSAO = { enableImplicitConversion: true }
const VALIDACAO = { whitelist: true, forbidNonWhitelisted: true }
const recebido = (corpo: unknown) => plainToInstance(IssueCertificateAsAdminDto, corpo, CONVERSAO) as IssueCertificateAsAdminDto
const erros = async (corpo: unknown): Promise<Record<string, string[]>> =>
  Object.fromEntries((await validate(recebido(corpo), VALIDACAO)).map((e) => [e.property, Object.values(e.constraints ?? {})]))

describe('IssueCertificateAsAdminDto', () => {
  it('corpo vazio vale: o nome e o CPF vêm do cadastro', async () => {
    expect(await erros({})).toEqual({})
  })

  it.each(['52998224725', '529.982.247-25'])('aceita o CPF válido %p', async (cpf) => {
    expect(await erros({ cpf })).toEqual({})
  })

  it.each([123, '123', '111', '11111111111', '111.111.111-11', '52998224724', ''])('recusa o CPF %p em português', async (cpf) => {
    expect(await erros({ cpf })).toEqual({ cpf: ['CPF inválido.'] })
  })

  it('o nome é opcional e, quando vem, é texto', async () => {
    expect(await erros({ nome: 'Ana Maria' })).toEqual({})
    expect(await erros({ nome: ['Ana'] })).toEqual({ nome: ['Informe o nome do aluno como texto.'] })
  })

  it('recusa campo a mais: o aluno, o curso e o polo vêm da rota', async () => {
    expect(Object.keys(await erros({ cpf: '52998224725', tenantId: 'outro', courseId: 'c2' })).sort()).toEqual(['courseId', 'tenantId'])
  })
})
