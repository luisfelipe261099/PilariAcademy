import { RequestMethod } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import express from 'express'
import { PtBrValidationPipe } from './common/lib/validation-pipe'
import { TenantsService } from './modules/tenancy/tenants.service'
import { tenantMiddleware } from './modules/tenancy/tenant.middleware'
import { TENANT_NOT_FOUND_HTML } from './modules/tenancy/not-found-page'
import { IndexRenderer, isIndexHtmlPath } from './modules/tenancy/render-index'
import type { RequestWithTenant } from './modules/tenancy/tenant-request'

export interface ConfigureAppOptions {
  isProd: boolean
  /** index.html do client buildado. null quando o SPA não está junto (API em dev). */
  indexHtml: string | null
  /** Pasta do client buildado para os estáticos. null quando não há estáticos a servir (a maioria dos testes). */
  clientDir: string | null
}

/**
 * Configuração compartilhada entre o main.ts e a suíte de integração. A ORDEM importa: o
 * middleware do polo vem antes dos estáticos, do fallback do SPA e do router do Nest, para
 * toda requisição chegar com req.tenant resolvido ou parar num 404.
 */
export function configureApp(app: NestExpressApplication, opts: ConfigureAppOptions): void {
  const instance = app.getHttpAdapter().getInstance()
  const tenantsService = app.get(TenantsService)
  instance.use(tenantMiddleware(tenantsService, { notFoundHtml: TENANT_NOT_FOUND_HTML }))

  // API sob /api. Exceção: o webhook do Asaas fica em /webhooks/asaas (URL registrada no Asaas).
  app.setGlobalPrefix('api', { exclude: [{ path: 'webhooks/asaas', method: RequestMethod.POST }] })
  // Em produção o SPA é servido pela mesma origem (sem CORS). No dev, o Vite (5173/5174), também
  // em subdomínios de polo como piloto.localhost.
  if (!opts.isProd) app.enableCors({ origin: [/^http:\/\/([a-z0-9-]+\.)?localhost:517[34]$/] })
  // Mensagens de validação em português, no formato de sempre (campo fora do DTO: "O campo X não é aceito.").
  app.useGlobalPipes(
    new PtBrValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } })
  )

  if (opts.indexHtml) {
    const renderer = new IndexRenderer(opts.indexHtml, (t) => tenantsService.siteUrl(t))
    if (opts.clientDir) {
      // Arquivos de /assets têm hash no nome (Vite): imutáveis, 1 ano. O resto revalida por ETag.
      const estaticos = express.static(opts.clientDir, {
        index: false,
        setHeaders: (res, filePath) => {
          const hashedAsset = filePath.replace(/\\/g, '/').includes('/assets/')
          res.setHeader('Cache-Control', hashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache')
        },
      })
      // O index.html cru tem a marca da matriz: pedido por ele, em qualquer grafia, cai no fallback renderizado.
      instance.use((req: express.Request, res: express.Response, next: express.NextFunction) =>
        isIndexHtmlPath(req.path) ? next() : estaticos(req, res, next)
      )
    }
    // Fallback do SPA: GET fora de /api sem arquivo estático → index.html do polo do endereço.
    // Middleware, não rota com RegExp (o Express 5 mudou isso); o HTML vem da memória, sem
    // res.sendFile nem a trava de dotfiles dele. no-cache: o index.html aponta para os assets
    // com hash e precisa estar sempre atual.
    instance.use((req: RequestWithTenant, res: express.Response, next: express.NextFunction) => {
      if (req.method === 'GET' && !req.path.startsWith('/api') && req.tenant) {
        res.setHeader('Cache-Control', 'no-cache')
        res.type('html').send(renderer.render(req.tenant))
      } else {
        next()
      }
    })
  }
}
