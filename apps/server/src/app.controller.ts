import { Body, Controller, Get, HttpCode, Logger, Post } from '@nestjs/common'
import type { ApiMessage } from '@pilari/types'
import { Public } from './common/decorators/public.decorator'
import { AppService } from './app.service'

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name)

  constructor(private readonly appService: AppService) {}

  @Public()
  @Get('hello')
  getHello(): ApiMessage {
    return this.appService.getHello()
  }

  /**
   * Recebe violações da CSP (report-uri). Só loga: o objetivo é enxergar em produção o que a
   * policy bloquearia (fase Report-Only) e ajustar antes de ligar o CSP_ENFORCE=1.
   * Truncado e sem validação de shape — é conteúdo controlado pelo browser, não confiável.
   */
  @Public()
  @Post('csp-report')
  @HttpCode(204)
  cspReport(@Body() body: unknown): void {
    const report = (body as Record<string, unknown> | null)?.['csp-report'] ?? body
    this.logger.warn(`Violação de CSP: ${JSON.stringify(report ?? {}).slice(0, 1000)}`)
  }
}
