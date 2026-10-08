import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

/**
 * Extrai só as descrições de erro ({errors: [{code, description}]}) de uma resposta do Asaas.
 * Nunca logar a resposta inteira: o erro do /customers ecoa nome, e-mail e CPF do aluno (PII).
 */
function errorSummary(json: unknown): string {
  const errors = json && typeof json === 'object' ? (json as { errors?: unknown }).errors : null
  const descriptions = (Array.isArray(errors) ? errors : [])
    .map((e) => (e && typeof e === 'object' ? (e as { description?: unknown }).description : null))
    .filter((d): d is string => typeof d === 'string')
  return (descriptions.join('; ') || 'sem descrição de erro').slice(0, 300)
}

/**
 * Toda chamada ao Asaas passa por aqui, e o motivo é o timeout.
 *
 * `fetch` do Node NÃO tem timeout padrão: uma conexão pendurada no Asaas fica pendurada
 * para sempre do nosso lado. No Cloud Run isso prende a requisição até o teto da
 * plataforma (300s), com um efeito colateral pior no checkout: o aluno acha que travou,
 * recarrega e tenta de novo — e o `createInstallment` não é idempotente, então a segunda
 * tentativa gera um SEGUNDO carnê de boletos reais, que o Asaas não deixa cancelar.
 *
 * 20s é folgado para uma API de pagamento e curto o bastante para o aluno ver um erro
 * em vez de uma tela parada. O `paymentBook` ganha mais tempo: ele renderiza um PDF com
 * todos os boletos do lado do Asaas.
 */
const TIMEOUT_MS = 20_000
const TIMEOUT_PDF_MS = 45_000

async function fetchComTimeout(url: string, init: RequestInit, timeoutMs = TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    // Sempre limpar: sem isto o timer segura o event loop e o processo não encerra.
    clearTimeout(timer)
  }
}

/**
 * Campos do pagamento que a reconciliação usa. Leitura defensiva: campo ausente vale `null`.
 * Pagamentos criados pelo `/payments` antigo não têm `paymentLink` nem `installmentCount`,
 * e isso não pode quebrar a liberação de pedidos legados.
 */
function toPayment(json: Record<string, unknown>) {
  return {
    id: String(json.id),
    status: String(json.status),
    value: typeof json.value === 'number' ? json.value : null,
    netValue: typeof json.netValue === 'number' ? json.netValue : null,
    externalReference: typeof json.externalReference === 'string' ? json.externalReference : null,
    paymentLink: typeof json.paymentLink === 'string' ? json.paymentLink : null,
    installmentCount: typeof json.installmentCount === 'number' ? json.installmentCount : null,
    billingType: typeof json.billingType === 'string' ? json.billingType : null,
    /** Id do plano de parcelamento. Só vem quando a cobrança pertence a um carnê. */
    installment: typeof json.installment === 'string' ? json.installment : null,
    installmentNumber: typeof json.installmentNumber === 'number' ? json.installmentNumber : null,
    dueDate: typeof json.dueDate === 'string' ? json.dueDate : null,
  }
}

export type AsaasPayment = ReturnType<typeof toPayment>

/**
 * Vencimento no formato do Asaas (AAAA-MM-DD). Sem data informada, 3 dias — o padrão que
 * o checkout do aluno sempre usou.
 *
 * Data no PASSADO é rejeitada aqui, e não no Asaas: um boleto vencido nasce impagável, e o
 * erro de lá voltaria como 400 opaco sem dizer qual campo.
 */
export function resolveDueDate(informada?: string | null): string {
  if (informada) {
    const hoje = new Date().toISOString().slice(0, 10)
    if (informada < hoje) throw new BadRequestException('O vencimento não pode ser anterior a hoje.')
    return informada
  }
  const due = new Date()
  due.setDate(due.getDate() + 3)
  return due.toISOString().slice(0, 10)
}

/** Wrapper da API do Asaas (checkout hospedado). Não lida com dados de cartão. */
@Injectable()
export class AsaasService {
  private readonly logger = new Logger(AsaasService.name)

  constructor(private readonly config: ConfigService) {}

  private base(): string {
    const configured = this.config.get<string>('ASAAS_BASE_URL')
    if (configured) return configured
    // Falhar alto em produção: cair no sandbox com a chave real gera 401 silencioso em todo
    // o checkout. Já aconteceu — o .env definia ASAAS_API_URL e ninguém percebeu.
    if (process.env.NODE_ENV === 'production') {
      throw new InternalServerErrorException('ASAAS_BASE_URL não configurada.')
    }
    return 'https://sandbox.asaas.com/api/v3'
  }

  private async call(path: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await fetchComTimeout(`${this.base()}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        access_token: this.config.get<string>('ASAAS_API_KEY') || '',
      },
      body: JSON.stringify(body),
    })
    const json = (await res.json()) as Record<string, unknown>
    if (!res.ok) {
      // Detalhe do upstream fica só no log do servidor; o cliente recebe mensagem genérica.
      this.logger.error(`Asaas ${path} falhou (${res.status}): ${errorSummary(json)}`)
      throw new InternalServerErrorException('Falha ao comunicar com o provedor de pagamento.')
    }
    return json
  }

  /**
   * DELETE no Asaas. Existe separado do `call` porque aquele é POST com corpo; aqui não há
   * corpo e o método é outro.
   *
   * O Asaas RECUSA apagar cobrança já paga ou confirmada — e é bom que recuse. Por isso o
   * erro sobe: cancelar no nosso banco sem cancelar lá deixaria o boleto vivo, e o aluno
   * pagaria uma cobrança que o admin acha que excluiu.
   */
  private async remove(path: string): Promise<void> {
    const res = await fetchComTimeout(`${this.base()}${path}`, {
      method: 'DELETE',
      headers: { access_token: this.config.get<string>('ASAAS_API_KEY') || '' },
    })
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
      this.logger.error(`Asaas DELETE ${path} falhou (${res.status}): ${errorSummary(json)}`)
      throw new InternalServerErrorException('Falha ao cancelar a cobrança no provedor de pagamento.')
    }
  }

  /** Apaga uma cobrança avulsa. */
  async deleteCharge(chargeId: string): Promise<void> {
    return this.remove(`/payments/${chargeId}`)
  }

  /** Apaga o carnê INTEIRO — todos os boletos ainda não pagos do plano. */
  async deleteInstallment(installmentId: string): Promise<void> {
    return this.remove(`/installments/${installmentId}`)
  }

  /** Cria o cliente no Asaas e devolve o asaasCustomerId. */
  async ensureCustomer(input: { name: string; email: string; cpf: string }): Promise<string> {
    const json = await this.call('/customers', {
      name: input.name,
      email: input.email,
      cpfCnpj: input.cpf,
    })
    return String(json.id)
  }

  /** Cria a cobrança (billingType UNDEFINED → aluno escolhe PIX/cartão/boleto no checkout). */
  async createCharge(input: {
    customerId: string
    amountInCents: number
    description: string
    externalReference: string
    /** Vencimento AAAA-MM-DD. Ausente = 3 dias. */
    dueDate?: string | null
  }): Promise<{ chargeId: string; paymentUrl: string; status: string; dueDate: string; billingType: string }> {
    const dueDate = resolveDueDate(input.dueDate)
    const json = await this.call('/payments', {
      customer: input.customerId,
      billingType: 'UNDEFINED',
      value: input.amountInCents / 100,
      dueDate,
      description: input.description,
      externalReference: input.externalReference,
    })
    return {
      chargeId: String(json.id),
      paymentUrl: String(json.invoiceUrl),
      status: String(json.status),
      dueDate: String(json.dueDate ?? dueDate),
      billingType: String(json.billingType ?? 'UNDEFINED'),
    }
  }

  /**
   * Cria um LINK de pagamento. São DOIS formatos, porque no Asaas o parcelamento é
   * propriedade da COBRANÇA e não do meio de pagamento — não existe link em que o boleto
   * seja à vista e o cartão parcelado. Por isso o aluno escolhe antes, no nosso carrinho.
   *
   *   parcelado: false → billingType UNDEFINED + chargeType DETACHED
   *                      boleto, Pix e cartão; a tela diz "(somente à vista)".
   *   parcelado: true  → billingType CREDIT_CARD + chargeType INSTALLMENT
   *                      só cartão, com seletor de 1 a 10 parcelas.
   *
   * Duas armadilhas verificadas em produção, ambas silenciosas (respondem 200):
   *   - 'DETACHED' junto de maxInstallmentCount grava maxInstallmentCount: 1;
   *   - UNDEFINED + INSTALLMENT oferece parcelar TAMBÉM no boleto, virando carnê de 10
   *     títulos — e o acesso ao curso seria liberado no primeiro pago.
   */
  async createPaymentLink(input: {
    name: string
    amountInCents: number
    externalReference: string
    parcelado: boolean
  }): Promise<{ linkId: string; url: string }> {
    const base = {
      name: input.name,
      value: input.amountInCents / 100,
      externalReference: input.externalReference,
    }
    const json = await this.call(
      '/paymentLinks',
      input.parcelado
        ? { ...base, billingType: 'CREDIT_CARD', chargeType: 'INSTALLMENT', maxInstallmentCount: 10 }
        : { ...base, billingType: 'UNDEFINED', chargeType: 'DETACHED', dueDateLimitDays: 3 }
    )
    return { linkId: String(json.id), url: String(json.url) }
  }

  /**
   * Cria um PARCELAMENTO por API (carnê). Diferente do link, aqui QUEM DEFINE o número de
   * parcelas somos nós — e é por isso que este caminho existe: `installmentCount` não vem
   * na resposta de cobrança do Asaas, então depender do gateway para saber quantas parcelas
   * o pedido tem faria a quitação nunca acontecer.
   *
   * Enviamos `totalValue` e NÃO `installmentValue`: com `totalValue` o Asaas aplica a
   * diferença de centavos na última parcela sozinho.
   */
  async createInstallment(input: {
    customerId: string
    totalInCents: number
    installmentCount: number
    description: string
    externalReference: string
    /** Vencimento da PRIMEIRA parcela (AAAA-MM-DD). As demais o Asaas espaça de 30 em 30. */
    dueDate?: string | null
  }): Promise<{ chargeId: string; installmentId: string; paymentUrl: string; dueDate: string }> {
    const dueDate = resolveDueDate(input.dueDate)
    const json = await this.call('/payments', {
      customer: input.customerId,
      billingType: 'BOLETO',
      installmentCount: input.installmentCount,
      totalValue: input.totalInCents / 100,
      dueDate,
      description: input.description,
      externalReference: input.externalReference,
    })
    // `String(json.installment)` sem validar viraria a string 'undefined' num campo ausente —
    // e 'undefined' é truthy: o pedido passaria a ser um carnê (o discriminador é
    // `asaasInstallmentId != null`) cujas parcelas ninguém consegue listar, porque
    // GET /installments/undefined/payments responde 404 e listInstallmentPayments engole o
    // erro devolvendo lista vazia. O aluno pagaria as 5 parcelas e o certificado ficaria
    // PRESO PARA SEMPRE, sem uma linha de erro. Falhar aqui é caro (os boletos podem já
    // existir no Asaas), mas é o único ponto em que o problema ainda é visível.
    const installmentId = typeof json.installment === 'string' ? json.installment.trim() : ''
    if (!installmentId) {
      this.logger.error(
        `Asaas /payments criou a cobrança ${String(json.id)} sem o id do parcelamento (campo "installment" ausente ou vazio)`
      )
      throw new InternalServerErrorException('Falha ao criar o parcelamento no provedor de pagamento.')
    }
    return {
      chargeId: String(json.id),
      installmentId,
      paymentUrl: String(json.invoiceUrl),
      dueDate: String(json.dueDate ?? dueDate),
    }
  }

  /** Todas as cobranças de um parcelamento. */
  async listInstallmentPayments(installmentId: string): Promise<AsaasPayment[]> {
    const res = await fetchComTimeout(
      `${this.base()}/installments/${encodeURIComponent(installmentId)}/payments?limit=100`,
      { headers: { 'Content-Type': 'application/json', access_token: this.config.get<string>('ASAAS_API_KEY') || '' } }
    )
    const json = (await res.json()) as Record<string, unknown>
    if (!res.ok) {
      this.logger.error(`Asaas GET /installments/${installmentId}/payments falhou (${res.status}): ${errorSummary(json)}`)
      return []
    }
    const data = Array.isArray(json.data) ? json.data : []
    return data.map((p) => toPayment(p as Record<string, unknown>))
  }

  /** PDF do carnê (todos os boletos). Exige a chave de API — nunca expor ao navegador. */
  async getPaymentBook(installmentId: string): Promise<Buffer> {
    const res = await fetchComTimeout(
      `${this.base()}/installments/${encodeURIComponent(installmentId)}/paymentBook`,
      { headers: { access_token: this.config.get<string>('ASAAS_API_KEY') || '' } },
      TIMEOUT_PDF_MS
    )
    if (!res.ok) {
      this.logger.error(`Asaas GET paymentBook ${installmentId} falhou (${res.status})`)
      throw new InternalServerErrorException('Falha ao gerar o carnê.')
    }
    return Buffer.from(await res.arrayBuffer())
  }

  /**
   * Consulta a cobrança no Asaas (reconciliação pull + taxa real). `value` é o bruto
   * e `netValue` o líquido após a taxa do Asaas — a diferença é a taxa cobrada.
   */
  async getPayment(chargeId: string): Promise<AsaasPayment> {
    const res = await fetchComTimeout(`${this.base()}/payments/${encodeURIComponent(chargeId)}`, {
      headers: {
        'Content-Type': 'application/json',
        access_token: this.config.get<string>('ASAAS_API_KEY') || '',
      },
    })
    const json = (await res.json()) as Record<string, unknown>
    if (!res.ok) {
      this.logger.error(`Asaas GET /payments/${chargeId} falhou (${res.status}): ${errorSummary(json)}`)
      throw new InternalServerErrorException('Falha ao consultar o provedor de pagamento.')
    }
    return toPayment(json)
  }

  /**
   * Lista os pagamentos de um pedido. O filtro É `externalReference` — a API do Asaas
   * ignora parâmetros desconhecidos em silêncio, então filtrar por `paymentLink`
   * devolveria TODOS os pagamentos da conta e liberaria um pedido com o pagamento de
   * outra pessoa. Falha de rede → lista vazia: o pedido apenas segue pendente e a
   * próxima reconciliação tenta de novo (nunca liberar por engano).
   */
  async listPaymentsByExternalReference(ref: string): Promise<AsaasPayment[]> {
    const url = `${this.base()}/payments?externalReference=${encodeURIComponent(ref)}&limit=100`
    const res = await fetchComTimeout(url, {
      headers: {
        'Content-Type': 'application/json',
        access_token: this.config.get<string>('ASAAS_API_KEY') || '',
      },
    })
    const json = (await res.json()) as Record<string, unknown>
    if (!res.ok) {
      this.logger.error(`Asaas GET /payments?externalReference falhou (${res.status}): ${errorSummary(json)}`)
      return []
    }
    const data = Array.isArray(json.data) ? json.data : []
    return data.map((d) => toPayment(d as Record<string, unknown>))
  }
}
