import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { assertLocal } from './db'
import { FakeAsaasService, FakeGcsService, FakeIdentityService, FakePdfService } from './fakes'

/**
 * Host default de quem esquecer `.set('Host', ...)`. Supertest manda `127.0.0.1:<porta>` por
 * padrão, que `isMatrizFallbackHost` aceita fora de produção — um teste sem Host rodaria como
 * requisição da matriz e podia passar pelo motivo errado. `.invalid` é TLD reservado (RFC 2606):
 * nunca resolve a um polo de verdade, então o teste que esquecer o Host cai no 404 do middleware.
 */
const DEFAULT_HOST = 'host-nao-informado.invalid'

export interface TestApp {
  app: INestApplication
  http: () => ReturnType<typeof request>
  fakes: {
    identity: FakeIdentityService
    gcs: FakeGcsService
    asaas: FakeAsaasService
    pdf: FakePdfService
  }
  close: () => Promise<void>
}

/**
 * Sobe o AppModule inteiro contra um banco de teste. As variáveis de ambiente são definidas
 * ANTES do import do AppModule (import dinâmico), para o ConfigModule enxergá-las.
 * O DatabaseModule aplica todas as migrations no boot (banco local → trava liberada).
 */
export async function bootTestApp(databaseUrl: string, opts: { indexHtml?: string; clientDir?: string } = {}): Promise<TestApp> {
  assertLocal(databaseUrl)
  process.env.DATABASE_URL = databaseUrl
  process.env.AUTH_REQUIRED = '1'
  process.env.NODE_ENV = 'test'
  process.env.THROTTLE_DISABLED = '1'

  const { AppModule } = await import('../../../src/app.module')
  const { IdentityService } = await import('../../../src/modules/auth/identity.service')
  const { GcsService } = await import('../../../src/modules/classroom/gcs.service')
  const { AsaasService } = await import('../../../src/modules/enrollments/asaas.service')
  const { PdfService } = await import('../../../src/modules/certificate/pdf.service')

  const fakes = {
    identity: new FakeIdentityService(),
    gcs: new FakeGcsService(),
    asaas: new FakeAsaasService(),
    pdf: new FakePdfService(),
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider('FIREBASE_ADMIN_INIT')
    .useValue(true)
    .overrideProvider(IdentityService)
    .useValue(fakes.identity)
    .overrideProvider(GcsService)
    .useValue(fakes.gcs)
    .overrideProvider(AsaasService)
    .useValue(fakes.asaas)
    .overrideProvider(PdfService)
    .useValue(fakes.pdf)
    .compile()

  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'] })
  const { configureApp } = await import('../../../src/configure-app')
  configureApp(app, { isProd: false, indexHtml: opts.indexHtml ?? null, clientDir: opts.clientDir ?? null })
  await app.init()
  // agent (não a chamada direta) porque só o agent tem `.host(...)`: define o Host default por
  // requisição, e `.set('Host', ...)` de cada teste continua podendo sobrescrevê-lo.
  return { app, http: () => request.agent(app.getHttpServer()).host(DEFAULT_HOST), fakes, close: () => app.close() }
}
