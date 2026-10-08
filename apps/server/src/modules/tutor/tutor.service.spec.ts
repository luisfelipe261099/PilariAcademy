/// <reference types="jest" />
import { BadRequestException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common'
import { createDrizzleMock, withQueryResults, type DrizzleMock } from '../../__test-utils__/drizzle-mock'
import { CourseScopeService } from '../tenancy/course-scope.service'
import { TutorService } from './tutor.service'
import { pcmToWav } from './lib/wav'

function make(config: Record<string, string> = {}) {
  const db: DrizzleMock = createDrizzleMock()
  const material = { doModulo: jest.fn(async () => 'Turnover é a rotatividade.'), fontes: jest.fn(async () => new Map()) }
  const vertex = {
    gerar: jest.fn(async () => ({ texto: '{"transcricao":"o que é turnover","resposta":"É a rotatividade de pessoal."}', uso: { promptTokenCount: 10 } })),
    falar: jest.fn(),
  }
  const cfg = { get: (k: string) => config[k] }
  const service = new TutorService(db as never, new CourseScopeService(db as never), material as never, vertex as never, cfg as never)
  return { db, material, vertex, service }
}

const curso = { id: 'c1', slug: 'rh', title: 'Gestão de RH', status: 'published', tutorEnabled: true }
const POLO = { id: 't1', status: 'active' as const }
const mods = [{ id: 'm1', title: 'Módulo 01' }, { id: 'm5', title: 'Módulo 05' }]
/** Soma do mês como o MySQL devolve (SUM vem como string). */
const MES_LIVRE = [{ s: '0' }]
const wavB64 = (seg: number) => pcmToWav(Buffer.alloc(Math.round(seg * 32000)), 16000).toString('base64')

describe('TutorService', () => {
  describe('acesso', () => {
    it('curso sem tutor ligado → 404', async () => {
      const { db, service } = make()
      withQueryResults<unknown>(db, [{ ...curso, tutorEnabled: false }])
      await expect(service.acesso(POLO, 'u1', 'rh')).rejects.toBeInstanceOf(NotFoundException)
    })

    it('curso não publicado → 404, mesmo com tutor ligado', async () => {
      const { db, service } = make()
      withQueryResults<unknown>(db, [{ ...curso, status: 'draft' }])
      await expect(service.acesso(POLO, 'u1', 'rh')).rejects.toBeInstanceOf(NotFoundException)
    })

    it('polo suspenso → 403 (cada pergunta tem custo)', async () => {
      const { db, service } = make()
      withQueryResults<unknown>(db, [curso])
      await expect(service.acesso({ id: 't1', status: 'suspended' }, 'u1', 'rh')).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('sem matrícula ativa → 403', async () => {
      const { db, service } = make()
      withQueryResults<unknown>(db, [curso], [])
      await expect(service.acesso(POLO, 'u1', 'rh')).rejects.toBeInstanceOf(ForbiddenException)
    })
  })

  describe('perguntar', () => {
    it('limite diário estourado → 429 TUTOR_LIMIT, sem chamar o Gemini', async () => {
      const { db, vertex, service } = make({ TUTOR_DAILY_SECONDS: '600' })
      withQueryResults<unknown>(db, [curso], [{ id: 'e1' }], [{ s: 600 }])
      const erro = await service.perguntar(POLO, 'u1', 'rh', { moduleId: 'm1', texto: 'oi' }).then(() => null, (e: unknown) => e)
      expect(erro).toBeInstanceOf(HttpException)
      expect((erro as HttpException).getStatus()).toBe(429)
      expect((erro as HttpException).getResponse()).toMatchObject({ code: 'TUTOR_LIMIT' })
      expect(vertex.gerar).not.toHaveBeenCalled()
    })

    it('cota mensal do aluno (1 h incluída no plano) esgotada → 429 TUTOR_STUDENT_MONTHLY_LIMIT, sem chamar o Gemini', async () => {
      const { db, vertex, service } = make()
      withQueryResults<unknown>(db, [curso], [{ id: 'e1' }], [{ s: 100 }], [{ s: '3600' }])
      const erro = await service.perguntar(POLO, 'u1', 'rh', { moduleId: 'm1', texto: 'oi' }).then(() => null, (e: unknown) => e)
      expect((erro as HttpException).getStatus()).toBe(429)
      expect((erro as HttpException).getResponse()).toMatchObject({
        code: 'TUTOR_STUDENT_MONTHLY_LIMIT',
        message: expect.stringMatching(/^Você já usou a sua cota de 1 hora do tutor neste mês\. Ela renova no dia 1º de /),
      })
      expect(vertex.gerar).not.toHaveBeenCalled()
    })

    it('teto mensal da plataforma atingido → 429 TUTOR_MONTHLY_LIMIT, sem chamar o Gemini', async () => {
      const { db, vertex, service } = make({ TUTOR_MONTHLY_MINUTES: '100' })
      withQueryResults<unknown>(db, [curso], [{ id: 'e1' }], [], MES_LIVRE, [{ s: '6000' }])
      const erro = await service.perguntar(POLO, 'u1', 'rh', { moduleId: 'm1', texto: 'oi' }).then(() => null, (e: unknown) => e)
      expect((erro as HttpException).getStatus()).toBe(429)
      expect((erro as HttpException).getResponse()).toMatchObject({ code: 'TUTOR_MONTHLY_LIMIT', message: expect.stringContaining('volta no dia 1º de') })
      expect(vertex.gerar).not.toHaveBeenCalled()
    })

    it('módulo de outro curso → 400', async () => {
      const { db, service } = make()
      withQueryResults<unknown>(db, [curso], [{ id: 'e1' }], [], MES_LIVRE, MES_LIVRE, mods)
      await expect(service.perguntar(POLO, 'u1', 'rh', { moduleId: 'outro', texto: 'oi' })).rejects.toBeInstanceOf(BadRequestException)
    })

    it.each([
      ['não é WAV', Buffer.from('qualquer coisa que não é áudio de verdade nem tem cabeçalho RIFF/WAVE válido').toString('base64')],
      ['curto demais', wavB64(0.2)],
      ['longo demais', wavB64(61)],
    ])('áudio %s → 400', async (_caso, audio) => {
      const { db, vertex, service } = make()
      withQueryResults<unknown>(db, [curso], [{ id: 'e1' }], [], MES_LIVRE, MES_LIVRE, mods)
      await expect(service.perguntar(POLO, 'u1', 'rh', { moduleId: 'm1', audioWavBase64: audio })).rejects.toBeInstanceOf(BadRequestException)
      expect(vertex.gerar).not.toHaveBeenCalled()
    })

    it('pergunta em áudio: manda o material do módulo e conta os segundos falados', async () => {
      const { db, material, vertex, service } = make()
      withQueryResults<unknown>(db, [curso], [{ id: 'e1' }], [], MES_LIVRE, MES_LIVRE, mods, [], [{ s: 4 }], [{ s: '64' }])
      const r = await service.perguntar(POLO, 'u1', 'rh', { moduleId: 'm5', audioWavBase64: wavB64(3.2) })
      expect(material.doModulo).toHaveBeenCalledWith('m5')
      const pedido = JSON.stringify((vertex.gerar.mock.calls[0] as unknown[])[0])
      expect(pedido).toContain('Turnover é a rotatividade.')
      expect(pedido).toContain('audio/wav')
      expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ userUid: 'u1', seconds: 4, requests: 1 }))
      expect(r).toEqual({ transcricao: 'o que é turnover', resposta: 'É a rotatividade de pessoal.', usadosHoje: 4, limiteSegundos: 1800, usadosNoMes: 64, limiteMensalSegundos: 3600 })
    })

    it('pergunta digitada conta 10 s', async () => {
      const { db, service } = make()
      withQueryResults<unknown>(db, [curso], [{ id: 'e1' }], [], MES_LIVRE, MES_LIVRE, mods, [], [{ s: 10 }])
      await service.perguntar(POLO, 'u1', 'rh', { moduleId: 'm1', texto: 'O que é turnover?' })
      expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ seconds: 10 }))
    })

    it('resposta ilegível do modelo → 503 e não conta uso', async () => {
      const { db, vertex, service } = make()
      vertex.gerar.mockResolvedValueOnce({ texto: 'desculpe', uso: {} } as never)
      withQueryResults<unknown>(db, [curso], [{ id: 'e1' }], [], MES_LIVRE, MES_LIVRE, mods)
      await expect(service.perguntar(POLO, 'u1', 'rh', { moduleId: 'm1', texto: 'oi' })).rejects.toMatchObject({ status: 503 })
      expect(db.values).not.toHaveBeenCalled()
    })
  })

  describe('falar', () => {
    it('repassa os pedaços e conta os segundos efetivamente falados', async () => {
      const { db, vertex, service } = make()
      vertex.falar.mockImplementation(async function* () {
        yield Buffer.alloc(48000)
        yield Buffer.alloc(24000)
      })
      withQueryResults<unknown>(db, [curso], [{ id: 'e1' }], [], MES_LIVRE, MES_LIVRE, [])
      const recebidos: number[] = []
      await service.falar(POLO, 'u1', 'rh', 'Olá!', (p) => recebidos.push(p.length), new AbortController().signal)
      expect(recebidos).toEqual([48000, 24000])
      expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ seconds: 2 }))
    })

    it('aluno interrompeu: conta o que já tocou e não propaga o AbortError', async () => {
      const { db, vertex, service } = make()
      vertex.falar.mockImplementation(async function* () {
        yield Buffer.alloc(96000)
        const e = new Error('abortado')
        e.name = 'AbortError'
        throw e
      })
      withQueryResults<unknown>(db, [curso], [{ id: 'e1' }], [], MES_LIVRE, MES_LIVRE, [])
      await expect(service.falar(POLO, 'u1', 'rh', 'Olá!', () => undefined, new AbortController().signal)).resolves.toBeUndefined()
      expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ seconds: 2 }))
    })

    it('teto mensal atingido também barra a voz (não gera áudio)', async () => {
      const { db, vertex, service } = make({ TUTOR_MONTHLY_MINUTES: '100' })
      withQueryResults<unknown>(db, [curso], [{ id: 'e1' }], [], MES_LIVRE, [{ s: '6000' }])
      await expect(service.falar(POLO, 'u1', 'rh', 'Olá!', () => undefined, new AbortController().signal)).rejects.toMatchObject({ status: 429 })
      expect(vertex.falar).not.toHaveBeenCalled()
    })
  })

  describe('info', () => {
    it('sem teto atingido: pausa nula e o uso do dia do aluno', async () => {
      const { db, service } = make()
      withQueryResults<unknown>(db, [curso], [{ id: 'e1' }], mods, [{ s: 120 }], [{ s: '900' }], [{ s: '5000' }])
      expect(await service.info(POLO, 'u1', 'rh')).toMatchObject({ usadosHoje: 120, limiteSegundos: 1800, usadosNoMes: 900, limiteMensalSegundos: 3600, pausa: null })
    })

    it('teto do mês atingido: a página já abre avisando a pausa até o dia 1º', async () => {
      const { db, service } = make({ TUTOR_MONTHLY_MINUTES: '100' })
      withQueryResults<unknown>(db, [curso], [{ id: 'e1' }], mods, [], MES_LIVRE, [{ s: '6000' }])
      const info = await service.info(POLO, 'u1', 'rh')
      expect(info.pausa).toMatch(/^O tutor fez uma pausa e volta no dia 1º de /)
    })
  })
})
