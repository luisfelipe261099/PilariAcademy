/// <reference types="jest" />
import { Logger } from '@nestjs/common'
import { ReconcileCron } from './reconcile.cron'

describe('ReconcileCron', () => {
  it('roda reconcilePending e loga o resultado', async () => {
    const webhook = { reconcilePending: jest.fn(async () => ({ checked: 3, reconciled: 1, stillPending: 2, failed: 0 })) }
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    try {
      const cron = new ReconcileCron(webhook as never)
      await cron.run()
      expect(webhook.reconcilePending).toHaveBeenCalledTimes(1)
      expect(log.mock.calls.map((c) => String(c[0])).join(' | ')).toContain('Reconcile diário')
    } finally {
      log.mockRestore()
    }
  })

  it('uma falha no reconcilePending é capturada e logada — nunca derruba o processo', async () => {
    const webhook = { reconcilePending: jest.fn(async () => { throw new Error('Asaas fora do ar') }) }
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    try {
      const cron = new ReconcileCron(webhook as never)
      await expect(cron.run()).resolves.toBeUndefined()
      expect(error.mock.calls.map((c) => String(c[0])).join(' | ')).toContain('Reconcile diário falhou')
    } finally {
      error.mockRestore()
    }
  })
})
