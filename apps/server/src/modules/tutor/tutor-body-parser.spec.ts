import { Body, Controller, Module, Post } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { tutorAudioJsonParser } from './tutor-body-parser'

@Controller()
class EcoController {
  @Post('api/me/courses/:slug/tutor/ask')
  pergunta(@Body() body: { audio?: string }) {
    return { tamanho: body?.audio?.length ?? 0 }
  }

  @Post('api/outra')
  outra(@Body() body: { audio?: string }) {
    return { tamanho: body?.audio?.length ?? 0 }
  }
}

@Module({ controllers: [EcoController] })
class EcoModule {}

describe('tutorAudioJsonParser', () => {
  let app: NestExpressApplication
  let base: string
  const grande = JSON.stringify({ audio: 'A'.repeat(2_000_000) })

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(EcoModule, { logger: false })
    app.use(tutorAudioJsonParser())
    await app.listen(0)
    base = await app.getUrl()
  })
  afterAll(() => app.close())

  it('não se chama "jsonParser" (senão o Nest pula o parser padrão)', () => {
    expect(tutorAudioJsonParser().name).not.toBe('jsonParser')
  })

  it('aceita corpo de 2 MB na rota da pergunta do tutor', async () => {
    const r = await fetch(`${base}/api/me/courses/rh/tutor/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: grande })
    expect(r.status).toBe(201)
    expect(await r.json()).toEqual({ tamanho: 2_000_000 })
  })

  it('as outras rotas continuam com o limite padrão', async () => {
    const r = await fetch(`${base}/api/outra`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: grande })
    expect(r.status).toBe(413)
  })

  it('JSON pequeno nas outras rotas segue funcionando', async () => {
    const r = await fetch(`${base}/api/outra`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audio: 'abc' }) })
    expect(await r.json()).toEqual({ tamanho: 3 })
  })
})
