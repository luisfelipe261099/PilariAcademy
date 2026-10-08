/// <reference types="jest" />
import { UnauthorizedException } from '@nestjs/common'
import { WebhookController } from './webhook.controller'

function make(token = 'secret', reconcileToken?: string) {
  const config = {
    get: (k: string) =>
      k === 'ASAAS_WEBHOOK_TOKEN' ? token : k === 'RECONCILE_TOKEN' ? reconcileToken : undefined,
  }
  const webhookService = {
    handleEvent: jest.fn(async () => undefined),
    reconcilePending: jest.fn(async () => ({ checked: 3, reconciled: 1, stillPending: 2, failed: 0, installmentsReconciled: 1, settled: 0 })),
  }
  const audit = { log: jest.fn() }
  return {
    controller: new WebhookController(config as never, webhookService as never, audit as never),
    webhookService,
    audit,
  }
}

describe('WebhookController', () => {
  it('token inválido → 401', async () => {
    const { controller } = make('secret')
    await expect(
      controller.handle('errado', { event: 'PAYMENT_RECEIVED', payment: { id: 'p', status: 'RECEIVED' } })
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('token válido → chama o service e responde received', async () => {
    const { controller, webhookService } = make('secret')
    const res = await controller.handle('secret', { event: 'PAYMENT_RECEIVED', payment: { id: 'p', status: 'RECEIVED' } })
    expect(webhookService.handleEvent).toHaveBeenCalledWith('PAYMENT_RECEIVED', { id: 'p', status: 'RECEIVED' })
    expect(res).toEqual({ received: true })
  })

  it('token de tamanho diferente → 401 (secureCompare não quebra o timingSafeEqual)', async () => {
    const { controller } = make('secret')
    await expect(
      controller.handle('tok', { event: 'PAYMENT_RECEIVED', payment: { id: 'p', status: 'RECEIVED' } })
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('ASAAS_WEBHOOK_TOKEN ausente na config → 401', async () => {
    const config = { get: () => undefined }
    const controller = new WebhookController(config as never, { handleEvent: jest.fn() } as never, { log: jest.fn() } as never)
    await expect(
      controller.handle('qualquer', { event: 'PAYMENT_RECEIVED', payment: { id: 'p', status: 'RECEIVED' } })
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  describe('gatilho do Cloud Scheduler', () => {
    it('token correto → reconcilia e devolve o resultado', async () => {
      const { controller, webhookService, audit } = make('secret', 'cron-token')
      const r = await controller.reconcile('cron-token')
      expect(webhookService.reconcilePending).toHaveBeenCalled()
      expect(r.reconciled).toBe(1)
      // actorUid nulo: a trilha precisa distinguir o job de uma ação humana. tenantId nulo:
      // a conta Asaas é única, a conciliação é da plataforma, nunca de um polo.
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ tenantId: null, actorUid: null, action: 'asaas.reconcile' }))
    })

    it('token errado → 401 e NÃO reconcilia', async () => {
      const { controller, webhookService } = make('secret', 'cron-token')
      await expect(controller.reconcile('errado')).rejects.toBeInstanceOf(UnauthorizedException)
      expect(webhookService.reconcilePending).not.toHaveBeenCalled()
    })

    it('RECONCILE_TOKEN não configurado → 401 (fecha por padrão)', async () => {
      // Sem esta garantia, esquecer a variável no Cloud Run deixaria um endpoint público
      // capaz de martelar a API do Asaas em nosso nome.
      const { controller, webhookService } = make('secret', undefined)
      await expect(controller.reconcile('qualquer')).rejects.toBeInstanceOf(UnauthorizedException)
      await expect(controller.reconcile('')).rejects.toBeInstanceOf(UnauthorizedException)
      expect(webhookService.reconcilePending).not.toHaveBeenCalled()
    })
  })
})
