import { Body, Controller, Module, Post } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { cspReportJsonParser } from './csp-report-parser'

@Controller()
class EchoController {
  @Post('echo')
  echo(@Body() body: unknown) {
    return { received: body ?? null }
  }
}

@Module({ controllers: [EchoController] })
class EchoModule {}

describe('cspReportJsonParser', () => {
  it('não se chama "jsonParser" — senão o Nest pula o registro do parser padrão de application/json', () => {
    expect(cspReportJsonParser().name).not.toBe('jsonParser')
  })

  describe('registrado antes do init, como no bootstrap do main.ts', () => {
    let app: NestExpressApplication
    let baseUrl: string

    beforeAll(async () => {
      app = await NestFactory.create<NestExpressApplication>(EchoModule, { logger: false })
      app.use(cspReportJsonParser())
      await app.listen(0)
      const address = app.getHttpServer().address() as { port: number }
      baseUrl = `http://127.0.0.1:${address.port}`
    })

    afterAll(async () => {
      await app.close()
    })

    it('application/json continua parseado (regressão: todo POST JSON da API perdia o body)', async () => {
      const res = await fetch(`${baseUrl}/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId: 'abc' }),
      })
      expect(await res.json()).toEqual({ received: { courseId: 'abc' } })
    })

    it('application/csp-report é parseado (relatórios de violação da CSP)', async () => {
      const res = await fetch(`${baseUrl}/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/csp-report' },
        body: JSON.stringify({ 'csp-report': { 'blocked-uri': 'https://x' } }),
      })
      expect(await res.json()).toEqual({ received: { 'csp-report': { 'blocked-uri': 'https://x' } } })
    })
  })
})
