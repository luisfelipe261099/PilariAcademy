import 'reflect-metadata'
import 'dotenv/config'
import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'
import helmet from 'helmet'
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { AppModule } from './app.module'
import { configureApp } from './configure-app'
import { inlineScriptHashes } from './common/lib/csp'
import { cspReportJsonParser } from './common/lib/csp-report-parser'
import { tutorAudioJsonParser } from './modules/tutor/tutor-body-parser'

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)
  const isProd = process.env.NODE_ENV === 'production'

  // Atrás do proxy do Cloud Run: confia no primeiro hop para que o IP real (X-Forwarded-For)
  // chegue ao rate limiter (ThrottlerGuard) — senão todos os pedidos compartilham o IP do proxy.
  app.set('trust proxy', 1)

  // SPA buildado (produção: o mesmo container serve client + API). Lido antes do helmet
  // porque a CSP precisa dos hashes dos scripts inline do index.html.
  const clientDir = join(__dirname, '..', 'public')
  const indexHtmlPath = join(clientDir, 'index.html')
  const indexHtml = existsSync(indexHtmlPath) ? readFileSync(indexHtmlPath, 'utf-8') : null

  // Headers de segurança (HSTS, X-Frame-Options=SAMEORIGIN, noSniff, Referrer-Policy, CORP…).
  //
  // CSP: SPA e API na mesma origem. O script inline de tema entra por hash sha256 calculado
  // do index.html buildado — um rebuild muda o hash sozinho, sem manutenção manual.
  // img/media liberam qualquer https: porque capa de curso e "vídeo por link" são URLs
  // externas coladas pelo instrutor (imagem/vídeo não executam script; contra XSS o que
  // importa é o script-src). style-src precisa de 'unsafe-inline' pelos style={{...}} do React.
  // Rollout (ID-02): por padrão sai em Report-Only — violações caem no /api/csp-report via
  // report-uri. Depois de rodar limpo em produção, defina CSP_ENFORCE=1 para passar a bloquear.
  //
  // COEP segue desligado de propósito: require-corp quebraria os embeds do YouTube (não
  // enviam CORP) e nada aqui usa SharedArrayBuffer/crossOriginIsolated — só quebra, sem ganho.
  // COOP fica em same-origin-allow-popups para não quebrar um futuro login por popup do Firebase.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        reportOnly: process.env.CSP_ENFORCE !== '1',
        directives: {
          'default-src': ["'self'"],
          'base-uri': ["'self'"],
          'object-src': ["'none'"],
          'frame-ancestors': ["'self'"],
          'form-action': ["'self'"],
          'script-src': ["'self'", ...inlineScriptHashes(indexHtml ?? '')],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:', 'blob:', 'https:'],
          'media-src': ["'self'", 'blob:', 'https:'],
          'font-src': ["'self'"],
          'connect-src': [
            "'self'",
            'https://identitytoolkit.googleapis.com', // Firebase Auth (login/cadastro)
            'https://securetoken.googleapis.com', // refresh do ID token
            'https://storage.googleapis.com', // upload direto ao GCS via signed URL
            'https://vercel.com', // upload direto ao Vercel Blob via presigned URL (API de controle)
          ],
          // Aulas do YouTube (iframe) e PDFs da classroom (mesma origem, /api/files/...).
          'frame-src': ["'self'", 'https://www.youtube.com', 'https://www.youtube-nocookie.com'],
          'worker-src': ["'self'", 'blob:'],
          'report-uri': ['/api/csp-report'],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    })
  )

  // Relatórios de violação de CSP chegam com content-type próprio, que o json parser
  // padrão do Nest não lê. Limite baixo: é só um relatório pequeno por POST.
  // NUNCA registrar express.json() direto aqui: o nome da função (jsonParser) faz o Nest
  // pular o parser padrão de application/json e a API inteira perde o body dos POSTs JSON.
  app.use(cspReportJsonParser())
  // Pergunta do tutor de voz: áudio em base64, até 4 MB, só nesta rota.
  app.use(tutorAudioJsonParser())

  configureApp(app, { isProd, indexHtml, clientDir: indexHtml ? clientDir : null })

  const port = process.env.PORT ? Number(process.env.PORT) : 3000
  await app.listen(port, '0.0.0.0')
  console.log(`🚀 Server rodando na porta ${port} (API em /api)`)
}

void bootstrap()
