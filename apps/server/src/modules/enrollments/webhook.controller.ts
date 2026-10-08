import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Logger, Post, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { timingSafeEqual } from 'node:crypto'
import { Public } from '../../common/decorators/public.decorator'
import type { AsaasReconcileResult } from '@pilari/types'
import { WebhookService } from './webhook.service'
import { AuditService } from '../audit/audit.service'

interface AsaasWebhookBody {
  event: string
  // value = bruto, netValue = líquido após a taxa do Asaas (o Asaas envia ambos no payload).
  payment: { id: string; status: string; value?: number; netValue?: number }
}

/**
 * Compara o token em tempo constante (evita timing attack). timingSafeEqual
 * exige buffers de mesmo tamanho — o cheque de length precede a chamada.
 */
function secureCompare(received: string | undefined, expected: string | undefined): boolean {
  if (!received || !expected) return false
  const a = Buffer.from(received)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name)
  constructor(
    private readonly config: ConfigService,
    private readonly webhookService: WebhookService,
    private readonly audit: AuditService
  ) {}

  @Public()
  @Post('asaas')
  @HttpCode(200)
  async handle(
    @Headers('asaas-access-token') token: string,
    @Body() body: AsaasWebhookBody
  ): Promise<{ received: true }> {
    const expected = this.config.get<string>('ASAAS_WEBHOOK_TOKEN')
    if (!secureCompare(token, expected)) {
      throw new UnauthorizedException('Webhook token inválido.')
    }
    // O payload do Asaas não passa por DTO (o forbidNonWhitelisted global rejeitaria os dezenas
    // de campos que o Asaas envia). Validamos a forma mínima à mão para não estourar em runtime.
    if (!body?.event || !body?.payment?.id) {
      throw new BadRequestException('Payload do webhook inválido.')
    }
    await this.webhookService.handleEvent(body.event, body.payment)
    return { received: true }
  }

  /**
   * Gatilho da reconciliação diária, chamado pelo Cloud Scheduler.
   *
   * Por que não é o @Cron do Nest: o Cloud Run roda com min-instances=0, então às 04:00
   * não existe instância viva para o cron disparar — ele simplesmente nunca rodava. Um
   * job do Scheduler acorda o serviço, e é o padrão que o projeto já usa em outros jobs.
   *
   * Fecha por padrão: sem RECONCILE_TOKEN configurado o `secureCompare` devolve false e
   * a rota responde 401. Um endpoint público que reconcilia sem segredo seria um jeito de
   * qualquer um martelar a API do Asaas em nosso nome.
   */
  @Public()
  @Post('reconcile')
  @HttpCode(200)
  async reconcile(@Headers('x-reconcile-token') token: string): Promise<AsaasReconcileResult> {
    if (!secureCompare(token, this.config.get<string>('RECONCILE_TOKEN'))) {
      throw new UnauthorizedException('Token de reconciliação inválido.')
    }
    return this.reconciliar()
  }

  /**
   * O mesmo gatilho para o Cron da Vercel, que chama com GET e `Authorization: Bearer <CRON_SECRET>`. Fecha por padrão
   * como o POST: sem CRON_SECRET configurado, 401.
   */
  @Public()
  @Get('reconcile')
  async reconcileCron(@Headers('authorization') authorization: string | undefined): Promise<AsaasReconcileResult> {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
    if (!secureCompare(token, this.config.get<string>('CRON_SECRET'))) {
      throw new UnauthorizedException('Token do cron inválido.')
    }
    return this.reconciliar()
  }

  private async reconciliar(): Promise<AsaasReconcileResult> {
    const result = await this.webhookService.reconcilePending()
    this.logger.log(`Reconcile agendado: ${JSON.stringify(result)}`)
    // actorUid nulo = não foi humano. Sem esta trilha, uma liberação feita pelo job
    // apareceria no histórico do pedido sem nenhuma origem.
    // tenantId nulo pelo mesmo motivo do admin-reconcile.controller.ts: a conta Asaas é
    // única, a conciliação é da plataforma.
    this.audit.log({
      tenantId: null,
      actorUid: null,
      actorEmail: null,
      action: 'asaas.reconcile',
      summary: `Reconcile agendado: ${result.reconciled} liberados, ${result.installmentsReconciled ?? 0} parcelas de carnê conciliadas, de ${result.checked} consultados (${result.failed} falhas)`,
      targetType: 'order',
      targetId: null,
    })
    return result
  }
}
