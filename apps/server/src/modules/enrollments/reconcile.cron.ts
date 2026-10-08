import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { WebhookService } from './webhook.service'

/**
 * Um carnê depende de ~5 webhooks espalhados por 5 meses. Perder um deixa o certificado
 * preso até alguém apertar o botão de reconciliar no painel financeiro. Esta tarefa é a rede:
 * roda sozinha todo dia, sem depender de um admin lembrar de clicar.
 */
@Injectable()
export class ReconcileCron {
  private readonly logger = new Logger(ReconcileCron.name)
  constructor(private readonly webhook: WebhookService) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async run(): Promise<void> {
    // Erro capturado aqui, nunca propagado: um cron que lança derruba o processo do Nest
    // inteiro (não só a tarefa), e essa reconciliação é justamente a rede de segurança —
    // ela falhar não pode virar um incidente maior que o problema que ela existe pra cobrir.
    try {
      const out = await this.webhook.reconcilePending()
      this.logger.log(`Reconcile diário: ${JSON.stringify(out)}`)
    } catch (e) {
      this.logger.error(`Reconcile diário falhou: ${String(e)}`)
    }
  }
}
