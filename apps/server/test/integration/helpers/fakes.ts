import { Readable } from 'node:stream'
import type { CertData } from '../../../src/modules/certificate/pdf.service'

/** Firebase falso: o token `test:<uid>` vira o usuário <uid>. Qualquer outro token é inválido. */
export class FakeIdentityService {
  readonly emails = new Map<string, string>() // e-mail → uid já existente no "Firebase"
  readonly resetEmails: string[] = []
  /** Toda conta criada por createIdentity, com o que o Firebase receberia (a senha inclusive). */
  readonly created: Array<{ email: string; displayName: string; password: string }> = []
  /** Todo uid apagado por deleteIdentity, na ordem. */
  readonly deleted: string[] = []
  private seq = 0

  async verifyIdToken(token: string) {
    if (!token.startsWith('test:')) {
      const e = new Error('token inválido') as Error & { code: string }
      e.code = 'auth/invalid-id-token'
      throw e
    }
    const uid = token.slice('test:'.length)
    return { uid, email: `${uid}@teste.local` }
  }
  async getFirebaseUser(uid: string) {
    return { uid, email: `${uid}@teste.local`, displayName: `Usuário ${uid}`, photoURL: null }
  }
  async findUidByEmail(email: string): Promise<string | null> {
    return this.emails.get(email.toLowerCase()) ?? null
  }
  async createIdentity(email: string, displayName = '', password = ''): Promise<string> {
    this.seq += 1
    const uid = `novo-${this.seq}`
    this.emails.set(email.toLowerCase(), uid)
    this.created.push({ email: email.toLowerCase(), displayName, password })
    return uid
  }
  async setCustomClaims(): Promise<void> {}
  async updateUser(): Promise<void> {}
  async sendPasswordResetEmail(email: string): Promise<void> {
    this.resetEmails.push(email)
  }
  async revokeTokens(): Promise<void> {}
  /**
   * Contas sem último login no Firebase (nunca entraram). Vazio por padrão: toda conta conta como quem já entrou, salvo a
   * que o teste puser aqui.
   */
  readonly neverSignedIn = new Set<string>()
  async hasSignedIn(uid: string): Promise<boolean> {
    return !this.neverSignedIn.has(uid)
  }
  /** Como o Firebase: a conta some e o e-mail volta a ficar livre. */
  async deleteIdentity(uid: string): Promise<void> {
    this.deleted.push(uid)
    for (const [email, dono] of this.emails) if (dono === uid) this.emails.delete(email)
  }
}

/** GCS falso: nada é gravado de verdade. A leitura só devolve o que o teste pôs em `objects`. */
export class FakeGcsService {
  /**
   * "Bucket" do teste, por caminho. Vazio por padrão: toda leitura devolve `null`, como antes. `generation` é a versão
   * que o metadado informa (padrão '1').
   */
  readonly objects = new Map<string, { buffer: Buffer; contentType: string; generation?: string }>()
  /** Todo caminho pedido a `readObject`, na ordem — para provar que um objeto NÃO foi lido. */
  readonly reads: string[] = []

  async signedUrl(p: string | null | undefined) {
    return p ? `https://gcs.fake/${p}` : null
  }
  /** Como o GcsService: acima de `maxBytes` (bytes de verdade do objeto), devolve `null`, como se não existisse. */
  async readObject(p?: string | null, opts: { maxBytes?: number } = {}) {
    if (p) this.reads.push(p)
    const obj = (p && this.objects.get(p)) || null
    if (obj && opts.maxBytes != null && obj.buffer.length > opts.maxBytes) return null
    return obj
  }
  /** O metadado do objeto: a geração (fixa as leituras seguintes), o tamanho e o tipo. */
  async statObject(p?: string | null) {
    const obj = p ? this.objects.get(p) : undefined
    return obj ? { generation: obj.generation ?? '1', size: obj.buffer.length, contentType: obj.contentType } : null
  }
  async playableUrl(v: string | null | undefined) {
    if (!v) return null
    return /^https?:\/\//i.test(v) ? v : `https://gcs.fake/${v}`
  }
  async saveObject() {
    return true
  }
  async deleteObject() {
    return true
  }
  async signedUploadUrl(p: string) {
    return `https://upload.fake/${p}`
  }
  /** Todo caminho pedido a `readHead`, na ordem (a conferência da assinatura do PDF, antes do stream). */
  readonly headReads: string[] = []
  /** Todo caminho aberto por `openReadStream`, na ordem: prova que um objeto foi (ou não) transmitido. */
  readonly streams: string[] = []
  /** Cada leitura do começo e cada stream, com a geração pedida: prova que as duas leram a mesma versão. */
  readonly pinnedReads: Array<{ op: 'head' | 'stream'; path: string; generation: string | null | undefined }> = []

  /** Os primeiros `bytes` do objeto do "bucket", como o download de intervalo do GCS. */
  async readHead(p: string | null | undefined, bytes: number, opts: { generation?: string | null } = {}) {
    if (p) {
      this.headReads.push(p)
      this.pinnedReads.push({ op: 'head', path: p, generation: opts.generation })
    }
    const obj = p ? this.objects.get(p) : undefined
    return obj ? obj.buffer.subarray(0, bytes) : null
  }
  /** O objeto em pedaços de 16 KB, como o stream do GCS: o teste prova que ele chega inteiro mesmo transmitido aos poucos. */
  openReadStream(p: string | null | undefined, opts: { generation?: string | null } = {}) {
    const obj = p ? this.objects.get(p) : undefined
    if (!p || !obj) return null
    this.streams.push(p)
    this.pinnedReads.push({ op: 'stream', path: p, generation: opts.generation })
    const pedacos: Buffer[] = []
    for (let i = 0; i < obj.buffer.length; i += 16 * 1024) pedacos.push(obj.buffer.subarray(i, i + 16 * 1024))
    return Readable.from(pedacos)
  }
}

/** Asaas falso: nenhuma cobrança real. */
export class FakeAsaasService {
  async deleteCharge() {}
  async deleteInstallment() {}
  async ensureCustomer() {
    return 'cus_fake'
  }
  async createCharge() {
    return {
      chargeId: 'pay_fake',
      paymentUrl: 'https://asaas.fake/pay',
      status: 'PENDING',
      dueDate: '2099-01-01',
      billingType: 'BOLETO',
    }
  }
  async createPaymentLink() {
    return { url: 'https://asaas.fake/link', linkId: 'lnk_fake' }
  }
  async createInstallment() {
    return {
      chargeId: 'pay_fake_1',
      installmentId: 'ins_fake',
      paymentUrl: 'https://asaas.fake/carne',
      dueDate: '2099-01-01',
    }
  }
  async listInstallmentPayments() {
    return []
  }
  async getPaymentBook() {
    return Buffer.from('%PDF-carne-fake')
  }
  async getPayment(): Promise<never> {
    throw new Error('getPayment não deve ser chamado nos testes de integração')
  }
  async listPaymentsByExternalReference() {
    return []
  }
}

export class FakePdfService {
  /** Os dados de cada PDF pedido, na ordem — para conferir o que iria impresso (a imagem da rubrica, por exemplo). */
  readonly calls: CertData[] = []

  async generate(data?: CertData) {
    if (data) this.calls.push(data)
    return Buffer.from('%PDF-1.4 fake')
  }
}
