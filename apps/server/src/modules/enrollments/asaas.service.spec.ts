/// <reference types="jest" />
import { Logger } from '@nestjs/common'
import { AsaasService } from './asaas.service'

function makeService() {
  const config = {
    get: (k: string) =>
      ({ ASAAS_BASE_URL: 'https://sandbox/api/v3', ASAAS_API_KEY: 'key' } as Record<string, string>)[k],
  }
  return new AsaasService(config as never)
}

describe('AsaasService', () => {
  afterEach(() => jest.restoreAllMocks())

  it('ensureCustomer cria cliente e retorna o id', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ id: 'cus_1' }) }))
    global.fetch = fetchMock as never
    const id = await makeService().ensureCustomer({ name: 'Ana', email: 'a@x.com', cpf: '12345678909' })
    expect(id).toBe('cus_1')
    const calls = fetchMock.mock.calls as unknown as unknown[][]
    expect(calls[0][0]).toContain('/customers')
  })

  it('createCharge envia value em reais e retorna chargeId + paymentUrl', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ id: 'pay_1', status: 'PENDING', invoiceUrl: 'http://pay', dueDate: '2026-06-28', billingType: 'UNDEFINED' }),
    }))
    global.fetch = fetchMock as never
    const res = await makeService().createCharge({ customerId: 'cus_1', amountInCents: 14900, description: 'Curso', externalReference: 'enr_1' })
    expect(res.chargeId).toBe('pay_1')
    expect(res.paymentUrl).toBe('http://pay')
    const calls = fetchMock.mock.calls as unknown as unknown[][]
    const body = JSON.parse((calls[0][1] as { body: string }).body)
    expect(body.value).toBe(149) // 14900 centavos => 149 reais
  })

  function mockLink() {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ id: 'link_1', url: 'https://www.asaas.com/c/link_1' }),
    }))
    global.fetch = fetchMock as never
    return () => JSON.parse(((fetchMock.mock.calls as unknown as unknown[][])[0][1] as { body: string }).body)
  }

  it('parcelado → só cartão, com chargeType INSTALLMENT e maxInstallmentCount 10', async () => {
    // Dois travamentos num teste só, porque os dois falham em silêncio:
    // - 'DETACHED' faz o Asaas responder 200 e gravar maxInstallmentCount: 1;
    // - billingType UNDEFINED oferece o parcelamento tambem no boleto (vira carne de 10).
    const body = mockLink()
    await makeService().createPaymentLink({ name: 'Curso', amountInCents: 549700, externalReference: 'ord_1', parcelado: true })
    expect(body().chargeType).toBe('INSTALLMENT')
    expect(body().maxInstallmentCount).toBe(10)
    expect(body().billingType).toBe('CREDIT_CARD')
  })

  it('à vista → boleto, Pix e cartão, SEM parcelamento e com prazo de 3 dias', async () => {
    const body = mockLink()
    await makeService().createPaymentLink({ name: 'Curso', amountInCents: 549700, externalReference: 'ord_1', parcelado: false })
    expect(body().billingType).toBe('UNDEFINED')
    expect(body().chargeType).toBe('DETACHED')
    expect(body().dueDateLimitDays).toBe(3)
    expect(body().maxInstallmentCount).toBeUndefined()
  })

  it('createPaymentLink envia value em reais e devolve linkId + url', async () => {
    const body = mockLink()
    const res = await makeService().createPaymentLink({ name: 'Curso', amountInCents: 549700, externalReference: 'ord_1', parcelado: false })
    expect(res.linkId).toBe('link_1')
    expect(res.url).toBe('https://www.asaas.com/c/link_1')
    expect(body().value).toBe(5497)
  })

  it('getPayment mapeia externalReference, paymentLink, installmentCount e billingType', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        id: 'pay_1', status: 'CONFIRMED', value: 549.7, netValue: 538.2,
        externalReference: 'ord_1', paymentLink: 'link_1',
        installmentCount: 10, billingType: 'CREDIT_CARD',
      }),
    })) as never
    const p = await makeService().getPayment('pay_1')
    expect(p.externalReference).toBe('ord_1')
    expect(p.paymentLink).toBe('link_1')
    expect(p.installmentCount).toBe(10)
    expect(p.billingType).toBe('CREDIT_CARD')
  })

  it('getPayment devolve null nos campos ausentes em vez de quebrar', async () => {
    // Pagamento antigo (criado pelo /payments) não tem paymentLink nem installmentCount.
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ id: 'pay_0', status: 'RECEIVED', value: 500, netValue: 489.76 }),
    })) as never
    const p = await makeService().getPayment('pay_0')
    expect(p.externalReference).toBeNull()
    expect(p.paymentLink).toBeNull()
    expect(p.installmentCount).toBeNull()
    expect(p.billingType).toBeNull()
    expect(p.value).toBe(500)
  })

  it('listPaymentsByExternalReference filtra pela QUERY externalReference, nunca por paymentLink', async () => {
    // A API do Asaas IGNORA query params desconhecidos e devolve a conta inteira.
    // Verificado em produção: ?paymentLink=<id> e ?filtroInvalidoXYZ=1 devolveram os
    // mesmos 2388 pagamentos. Filtrar por paymentLink liberaria um pedido com o
    // pagamento de outra pessoa. Este teste trava o nome do parâmetro.
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }))
    global.fetch = fetchMock as never
    await makeService().listPaymentsByExternalReference('ord_1')
    const url = String((fetchMock.mock.calls as unknown as unknown[][])[0][0])
    expect(url).toContain('externalReference=ord_1')
    expect(url).not.toContain('paymentLink')
  })

  it('listPaymentsByExternalReference mapeia cada item como o getPayment', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          { id: 'pay_1', status: 'CONFIRMED', value: 549.7, netValue: 538.2, externalReference: 'ord_1', paymentLink: 'link_1', installmentCount: 10, billingType: 'CREDIT_CARD' },
          { id: 'pay_2', status: 'PENDING', value: 549.7, netValue: null },
        ],
      }),
    })) as never
    const list = await makeService().listPaymentsByExternalReference('ord_1')
    expect(list).toHaveLength(2)
    expect(list[0].installmentCount).toBe(10)
    expect(list[1].paymentLink).toBeNull()
  })

  it('listPaymentsByExternalReference devolve [] quando o Asaas responde !ok', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    global.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as never
    await expect(makeService().listPaymentsByExternalReference('ord_1')).resolves.toEqual([])
  })

  it('lança erro quando o Asaas responde !ok', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 400, json: async () => ({ errors: [{ description: 'ruim' }] }) })) as never
    await expect(makeService().ensureCustomer({ name: 'A', email: 'a@x.com', cpf: '1' })).rejects.toThrow()
  })

  it('base() lança em produção quando ASAAS_BASE_URL não está definida', async () => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    const service = new AsaasService({ get: () => undefined } as never)
    try {
      await expect(service.ensureCustomer({ name: 'A', email: 'a@x.com', cpf: '1' })).rejects.toThrow(/ASAAS_BASE_URL/)
    } finally {
      process.env.NODE_ENV = prev
    }
  })

  it('base() usa o sandbox como fallback fora de produção', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ id: 'cus_1' }) }))
    global.fetch = fetchMock as never
    const service = new AsaasService({ get: () => undefined } as never)
    await service.ensureCustomer({ name: 'A', email: 'a@x.com', cpf: '1' })
    const calls = fetchMock.mock.calls as unknown as unknown[][]
    expect(String(calls[0][0])).toContain('sandbox.asaas.com')
  })

  it('não vaza PII no log de erro: só status HTTP + descrição (ID-04)', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    // O erro do /customers ecoa os dados enviados — nada disso pode aparecer no log.
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        errors: [{ code: 'invalid_cpf', description: 'CPF inválido' }],
        name: 'Ana Souza',
        email: 'ana@x.com',
        cpfCnpj: '12345678909',
      }),
    })) as never
    await expect(makeService().ensureCustomer({ name: 'Ana Souza', email: 'ana@x.com', cpf: '12345678909' })).rejects.toThrow()
    const logged = String(errorSpy.mock.calls[0][0])
    expect(logged).toContain('400')
    expect(logged).toContain('CPF inválido')
    expect(logged).not.toContain('Ana Souza')
    expect(logged).not.toContain('ana@x.com')
    expect(logged).not.toContain('12345678909')
  })

  it('log de erro do getPayment traz chargeId + status e aguenta resposta sem errors[]', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    global.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({ foo: 'bar' }) })) as never
    await expect(makeService().getPayment('pay_9')).rejects.toThrow()
    const logged = String(errorSpy.mock.calls[0][0])
    expect(logged).toContain('pay_9')
    expect(logged).toContain('500')
    expect(logged).toContain('sem descrição de erro')
    expect(logged).not.toContain('bar')
  })

  it('createInstallment envia BOLETO com installmentCount e totalValue', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        id: 'pay_1', installment: 'inst_1', installmentNumber: 1,
        invoiceUrl: 'https://www.asaas.com/i/1', dueDate: '2026-09-04', status: 'PENDING',
      }),
    }))
    global.fetch = fetchMock as never
    const out = await makeService().createInstallment({
      customerId: 'cus_1', totalInCents: 50000, installmentCount: 5,
      description: '1 curso(s) — Studio Pilari', externalReference: 'ord_1',
    })
    const calls = fetchMock.mock.calls as unknown as unknown[][]
    expect(String(calls[0][0])).toContain('/payments')
    const body = JSON.parse((calls[0][1] as { body: string }).body)
    expect(body.billingType).toBe('BOLETO')
    expect(body.installmentCount).toBe(5)
    expect(body.totalValue).toBe(500)
    expect(body.externalReference).toBe('ord_1')
    // installmentValue NÃO deve ser enviado junto de totalValue: o Asaas ajusta a
    // diferença de centavos na última parcela quando recebe só totalValue.
    expect(body.installmentValue).toBeUndefined()
    expect(out).toEqual({
      chargeId: 'pay_1', installmentId: 'inst_1',
      paymentUrl: 'https://www.asaas.com/i/1', dueDate: '2026-09-04',
    })
  })

  it.each([
    ['ausente', {}],
    ['nulo', { installment: null }],
    ['numérico', { installment: 123 }],
    ['string vazia', { installment: '   ' }],
  ])('createInstallment recusa resposta com o id do parcelamento %s', async (_caso, over) => {
    // Sem esta validação gravaríamos a string 'undefined' — que é TRUTHY, logo o pedido vira
    // um carnê cujas parcelas ninguém lista (GET /installments/undefined/payments dá 404 e
    // listInstallmentPayments engole o erro): o aluno paga tudo e o certificado fica preso
    // para sempre. Melhor estourar no checkout, onde ainda dá para ver.
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ id: 'pay_1', invoiceUrl: 'https://www.asaas.com/i/1', dueDate: '2026-09-04', ...over }),
    })) as never
    await expect(
      makeService().createInstallment({
        customerId: 'cus_1', totalInCents: 50000, installmentCount: 5,
        description: '1 curso(s) — Studio Pilari', externalReference: 'ord_1',
      })
    ).rejects.toThrow()
    expect(String(errorSpy.mock.calls[0][0])).toContain('pay_1')
  })

  it('listInstallmentPayments filtra pelo parcelamento na URL', async () => {
    // Teste de controle: a API do Asaas ignora parâmetro desconhecido em SILÊNCIO e
    // devolveria a conta inteira. Sem esta asserção, um filtro errado libera o pedido
    // de outra pessoa.
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: 'pay_1', status: 'RECEIVED', value: 100, netValue: 98, installmentNumber: 1 }] }),
    }))
    global.fetch = fetchMock as never
    const out = await makeService().listInstallmentPayments('inst_1')
    const calls = fetchMock.mock.calls as unknown as unknown[][]
    expect(String(calls[0][0])).toContain('/installments/inst_1/payments')
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('pay_1')
  })

  it('toPayment expõe installment, installmentNumber e dueDate', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        id: 'pay_2', status: 'CONFIRMED', value: 100, netValue: 98,
        installment: 'inst_9', installmentNumber: 3, dueDate: '2026-11-04',
      }),
    }))
    global.fetch = fetchMock as never
    const p = await makeService().getPayment('pay_2')
    expect(p.installment).toBe('inst_9')
    expect(p.installmentNumber).toBe(3)
    expect(p.dueDate).toBe('2026-11-04')
  })

  describe('timeout', () => {
    it('TODA chamada leva um AbortSignal — fetch do Node não tem timeout padrão', async () => {
      // Sem isto, uma conexão pendurada no Asaas prende a requisição até o teto do Cloud
      // Run (300s). No checkout é pior: o aluno recarrega, tenta de novo, e o
      // createInstallment (não idempotente) gera um SEGUNDO carnê de boletos reais.
      const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ id: 'x', invoiceUrl: 'u', installment: 'inst_1', dueDate: '2026-01-01' }) }))
      global.fetch = fetchMock as never
      const svc = makeService()

      await svc.ensureCustomer({ name: 'A', email: 'a@x.com', cpf: '12345678909' })
      await svc.getPayment('pay_1')
      await svc.listInstallmentPayments('inst_1')
      await svc.listPaymentsByExternalReference('ord_1')

      expect(fetchMock).toHaveBeenCalledTimes(4)
      for (const call of fetchMock.mock.calls as unknown[][]) {
        const init = call[1] as { signal?: unknown }
        expect(init?.signal).toBeInstanceOf(AbortSignal)
      }
    })

    it('abort do timeout propaga como erro — não devolve resposta vazia silenciosa', async () => {
      global.fetch = jest.fn(async () => {
        throw Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })
      }) as never
      const svc = makeService()
      // Um pedido travado tem que FALHAR alto no checkout, não seguir como se nada fosse.
      await expect(svc.ensureCustomer({ name: 'A', email: 'a@x.com', cpf: '1' })).rejects.toThrow()
    })
  })
})
