/// <reference types="jest" />
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import * as QRCode from 'qrcode'
import { createDrizzleMock, withQueryResults, type DrizzleMock } from '../../__test-utils__/drizzle-mock'
import { allWheres } from '../../__test-utils__/sql'
import { orders, tenants } from '../../db/schema'
import { CourseScopeService } from '../tenancy/course-scope.service'
import { CertificateService } from './certificate.service'
import { MAX_IMAGE_BYTES, MAX_PDF_CACHE_BYTES } from '../classroom/gcs.service'

function make() {
  const db: DrizzleMock = createDrizzleMock()
  const pdf = { generate: jest.fn(async () => Buffer.from('%PDF-mock-content-1234567890')) }
  const quiz = { allModuleQuizzesPassed: jest.fn(async () => true) }
  const gcs = { saveObject: jest.fn(async () => true), readObject: jest.fn(async () => null as { buffer: Buffer; contentType: string } | null), deleteObject: jest.fn(async () => true) }
  const config = { get: jest.fn((k: string): string | undefined => (k === 'WEB_PUBLIC_URL' ? 'https://cursos.studiopilari.com.br' : undefined)) }
  const templates = {
    getActiveHtml: jest.fn(async () => null as string | null),
    getActiveHtmlWithFingerprint: jest.fn(async () => ({ html: '<html>fabrica</html>', fingerprint: 'aaaaaaaaaaaa' })),
  }
  const installments = { listForOrder: jest.fn(async () => [] as Array<{ installmentNumber: number | null; valueInCents: number; status: string; dueDate: string | null; paidAt: string | null }>) }
  const asaas = { getPaymentBook: jest.fn(async () => Buffer.from('%PDF-carne-mock')) }
  // O escopo é o REAL, sobre o mesmo mock: `scope.bySlug` faz a mesma consulta única do antigo
  // select de curso, então a fila de resultados de cada teste continua valendo.
  const scope = new CourseScopeService(db as never)
  return {
    db,
    pdf,
    quiz,
    gcs,
    config,
    templates,
    installments,
    asaas,
    scope,
    service: new CertificateService(db as never, pdf as never, quiz as never, gcs as never, config as never, templates as never, installments as never, asaas as never, scope),
  }
}

const course = { id: 'c1', slug: 'curso', title: 'Curso', status: 'published' }
const POLO_A = { id: 't-a', isMatriz: false }
/** Todo caminho que o serviço pediu ao GCS, com qualquer opção: prova que um objeto NÃO foi lido. */
const caminhosLidos = (gcs: { readObject: jest.Mock }): unknown[] => gcs.readObject.mock.calls.map((c: unknown[]) => c[0])

describe('CertificateService', () => {
  it('não concluiu 100% → 403', async () => {
    const { db, service } = make()
    withQueryResults(db, [course], [{ id: 'e1' }], [{ total: 4, dur: 3600 }], [{ n: 2 }])
    await expect(service.issueOrGet(POLO_A, 'u1', 'curso')).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('100% concluído → congela snapshot, gera PDF e sobe no GCS', async () => {
    const { db, pdf, quiz, gcs, service } = make()
    withQueryResults(
      db,
      [course],
      [{ id: 'e1' }], // matrícula ativa
      [{ total: 2, dur: 7200 }],
      [{ n: 2 }], // concluiu tudo
      [], // cert existente? não (select certificates vem ANTES do select users no fluxo novo)
      [{ uid: 'u1', displayName: 'Ana', email: 'a@x.com', cpf: '12345678900' }], // user
      undefined, // insert cert
      undefined // update pdfPath (ensurePdf grava o caminho após subir no GCS)
    )
    const buf = await service.issueOrGet(POLO_A, 'u1', 'curso')
    // snapshot gravado no insert
    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', courseId: 'c1', studentName: 'Ana', courseTitle: 'Curso', hours: 2, status: 'issued', cpf: '12345678900' })
    )
    // O 2o argumento é o HTML RESOLVIDO (banco ou fábrica). Antes ia `undefined` e o
    // PdfService caía no fallback; agora quem resolve é o service, porque o fingerprint
    // do cache tem que corresponder exatamente ao HTML que gerou o PDF.
    expect(pdf.generate).toHaveBeenCalledWith(expect.objectContaining({ cpf: '123.456.789-00' }), expect.any(String))
    expect(gcs.saveObject).toHaveBeenCalled()
    expect(quiz.allModuleQuizzesPassed).toHaveBeenCalled()
    expect(buf.toString()).toContain('%PDF')
  })

  it('user sem cpf e sem param → BadRequestException', async () => {
    const { db, service } = make()
    withQueryResults(
      db,
      [course],
      [{ id: 'e1' }], // matrícula ativa
      [{ total: 2, dur: 7200 }],
      [{ n: 2 }], // concluiu tudo
      [], // cert existente? não
      [{ uid: 'u1', displayName: 'Ana', email: 'a@x.com' }] // user sem cpf
    )
    await expect(service.issueOrGet(POLO_A, 'u1', 'curso')).rejects.toBeInstanceOf(BadRequestException)
  })

  it('user sem displayName → BadRequestException, NUNCA imprime o e-mail', async () => {
    // O nome é congelado no snapshot da emissão: um e-mail impresso aqui ficaria no
    // documento para sempre. Antes o código caía em `displayName || email || 'Aluno'`.
    const { db, service } = make()
    withQueryResults(
      db,
      [course],
      [{ id: 'e1' }], // matrícula ativa
      [{ total: 2, dur: 7200 }],
      [{ n: 2 }], // concluiu tudo
      [], // cert existente? não
      [{ uid: 'u1', displayName: null, email: 'a@x.com', cpf: '12345678900' }]
    )
    await expect(service.issueOrGet(POLO_A, 'u1', 'curso')).rejects.toThrow(/nome completo/i)
  })

  it('displayName só com espaços é tratado como ausente', async () => {
    const { db, service } = make()
    withQueryResults(
      db,
      [course],
      [{ id: 'e1' }],
      [{ total: 2, dur: 7200 }],
      [{ n: 2 }],
      [],
      [{ uid: 'u1', displayName: '   ', email: 'a@x.com', cpf: '12345678900' }]
    )
    await expect(service.issueOrGet(POLO_A, 'u1', 'curso')).rejects.toThrow(/nome completo/i)
  })

  it('baixar certificado antigo com e-mail no snapshot → corrige o nome e invalida o PDF cacheado', async () => {
    // Certificados emitidos antes da correção congelaram o e-mail como "nome". Ao
    // clicar em baixar, o snapshot tem que ser CORRIGIDO, não repetido.
    const { db, service } = make()
    withQueryResults(
      db,
      [course],
      [{ id: 'e1' }], // matrícula ativa
      [{ total: 2, dur: 7200 }],
      [{ n: 2 }], // concluiu tudo
      [{ id: 'c1', code: 'ABC', studentName: 'a@x.com', courseTitle: 'Curso', hours: 2, cpf: '12345678900', pdfPath: 'certificates/c1/ABC.pdf', status: 'issued' }],
      [{ uid: 'u1', displayName: 'Ana Maria', email: 'a@x.com', cpf: '12345678900' }]
    )
    await service.issueOrGet(POLO_A, 'u1', 'curso')
    const patch = db.set.mock.calls.map((c: unknown[]) => c[0] as Record<string, unknown>).find((p) => 'studentName' in p)
    expect(patch?.studentName).toBe('Ana Maria')
    // Sem zerar o pdfPath, o download seguinte devolveria o PDF antigo com o e-mail.
    expect(patch?.pdfPath).toBeNull()
  })

  it('baixar certificado com e-mail no snapshot e usuário ainda sem nome → barra', async () => {
    const { db, service } = make()
    withQueryResults(
      db,
      [course],
      [{ id: 'e1' }],
      [{ total: 2, dur: 7200 }],
      [{ n: 2 }],
      [{ id: 'c1', code: 'ABC', studentName: 'a@x.com', courseTitle: 'Curso', hours: 2, cpf: '12345678900', pdfPath: null, status: 'issued' }],
      [{ uid: 'u1', displayName: null, email: 'a@x.com', cpf: '12345678900' }]
    )
    await expect(service.issueOrGet(POLO_A, 'u1', 'curso')).rejects.toThrow(/nome completo/i)
  })

  it('aluno sem nome cadastrado informa o nome no ato do download → emite e grava no cadastro', async () => {
    // Não existe tela de perfil para o aluno: sem aceitar o nome aqui, quem foi emitido
    // com e-mail no snapshot ficaria travado para sempre.
    const { db, service } = make()
    withQueryResults(
      db,
      [course],
      [{ id: 'e1' }],
      [{ total: 2, dur: 7200 }],
      [{ n: 2 }],
      [{ id: 'c1', code: 'ABC', studentName: 'a@x.com', courseTitle: 'Curso', hours: 2, cpf: '12345678900', pdfPath: null, status: 'issued' }],
      [{ uid: 'u1', displayName: null, email: 'a@x.com', cpf: '12345678900' }]
    )
    await service.issueOrGet(POLO_A, 'u1', 'curso', undefined, '  Ana   Maria  ')
    const patches = db.set.mock.calls.map((c: unknown[]) => c[0] as Record<string, unknown>)
    expect(patches.find((p) => 'studentName' in p)?.studentName).toBe('Ana Maria')
    // grava no cadastro para o e-mail parar de aparecer no lugar do nome no resto do sistema
    expect(patches.find((p) => 'displayName' in p)?.displayName).toBe('Ana Maria')
  })

  it('nome informado que é um e-mail é recusado', async () => {
    const { db, service } = make()
    withQueryResults(
      db,
      [course],
      [{ id: 'e1' }],
      [{ total: 2, dur: 7200 }],
      [{ n: 2 }],
      [],
      [{ uid: 'u1', displayName: null, email: 'a@x.com', cpf: '12345678900' }]
    )
    await expect(service.issueOrGet(POLO_A, 'u1', 'curso', undefined, 'a@x.com')).rejects.toThrow(/nome completo/i)
  })

  it('nome do CADASTRO vence o informado — aluno não reimprime outro nome no documento', async () => {
    const { db, service } = make()
    withQueryResults(
      db,
      [course],
      [{ id: 'e1' }],
      [{ total: 2, dur: 7200 }],
      [{ n: 2 }],
      [],
      [{ uid: 'u1', displayName: 'Ana Maria', email: 'a@x.com', cpf: '12345678900' }]
    )
    await service.issueOrGet(POLO_A, 'u1', 'curso', undefined, 'Outro Nome Qualquer')
    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ studentName: 'Ana Maria' }))
  })

  it('verify de código inexistente → valid false e hasDocument false', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    const v = await service.verify('NOPE')
    expect(v.valid).toBe(false)
    expect(v.hasDocument).toBe(false)
    expect(v.poloName).toBeNull()
  })

  describe('verify: polo que ofereceu o curso', () => {
    const cert = { code: 'ABC', status: 'issued', studentName: 'Ana', courseTitle: 'Excel', issuedAt: new Date() }

    it('a verificação mostra o polo que ofereceu o curso', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ cert, courseTitle: 'Excel', studentName: 'Ana', poloName: 'Polo A', poloIsMatriz: false }])
      expect((await service.verify('abc')).poloName).toBe('Polo A')
    })

    it('curso da matriz não mostra polo na verificação', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ cert, courseTitle: 'Excel', studentName: 'Ana', poloName: 'Studio Pilari', poloIsMatriz: true }])
      expect((await service.verify('abc')).poloName).toBeNull()
    })

    it('curso sem polo na junção (tenant ausente) → poloName null, nunca undefined', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ cert, courseTitle: 'Excel', studentName: 'Ana', poloName: null, poloIsMatriz: null }])
      expect((await service.verify('abc')).poloName).toBeNull()
    })

    it('certificado revogado continua informando o polo, mas não é válido', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ cert: { ...cert, status: 'revoked' }, courseTitle: 'Excel', studentName: 'Ana', poloName: 'Polo A', poloIsMatriz: false }])
      const v = await service.verify('abc')
      expect(v).toMatchObject({ valid: false, hasDocument: false, poloName: 'Polo A' })
    })

    it('é global: procura só pelo código, sem filtro de polo, e junta o polo do curso', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ cert, courseTitle: 'Excel', studentName: 'Ana', poloName: 'Polo A', poloIsMatriz: false }])
      await service.verify('abc')
      // o código do QR abre de QUALQUER endereço: a consulta não conhece o polo da requisição
      expect(allWheres(db.where)[0]).toEqual({ sql: '`certificates`.`code` = ?', params: ['ABC'] })
      // e o nome do polo vem do polo DONO DO CURSO (courses.tenant_id → tenants.id)
      expect(db.leftJoin).toHaveBeenCalledWith(tenants, expect.anything())
    })
  })

  it('getDocumentByCode inexistente → 404', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    await expect(service.getDocumentByCode('NOPE')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('getDocumentByCode (público) → CPF mascarado no PDF', async () => {
    const { db, pdf, service } = make()
    withQueryResults(db, [{ id: 'x1', userId: 'u1', courseId: 'c1', code: 'ABC', studentName: 'Ana', courseTitle: 'Curso', hours: 2, cpf: '12345678900', status: 'issued', pdfPath: null, issuedAt: new Date() }])
    await service.getDocumentByCode('ABC')
    expect(pdf.generate).toHaveBeenCalledWith(expect.objectContaining({ cpf: '***.***.***-**' }), expect.any(String))
  })

  it('getDocumentByCode: serve o PDF cacheado do GCS sem re-renderizar (anti-DoS)', async () => {
    const { db, pdf, gcs, service } = make()
    gcs.readObject.mockResolvedValueOnce({ buffer: Buffer.from('%PDF-cacheado'), contentType: 'application/pdf' })
    withQueryResults(db, [{ id: 'x1', userId: 'u1', courseId: 'c1', code: 'ABC', studentName: 'Ana', courseTitle: 'Curso', hours: 2, cpf: '12345678900', status: 'issued', pdfPath: null, issuedAt: new Date() }])
    const { buffer } = await service.getDocumentByCode('ABC')
    expect(buffer.toString()).toContain('%PDF-cacheado')
    expect(pdf.generate).not.toHaveBeenCalled()
    // com o teto do cache de PDF: objeto anormal no caminho não é carregado na memória (o PDF seria regerado)
    expect(gcs.readObject).toHaveBeenCalledWith(expect.stringMatching(/^certificates\/x1\/ABC-public-[0-9a-f]{12}\.pdf$/), { maxBytes: MAX_PDF_CACHE_BYTES })
  })

  it('invalidatePdfCache limpa o pdfPath dos certificados', async () => {
    const { db, service } = make()
    await service.invalidatePdfCache()
    expect(db.update).toHaveBeenCalled()
    expect(db.set).toHaveBeenCalledWith({ pdfPath: null })
  })

  it('template salvo no banco é repassado ao gerar o PDF', async () => {
    const { db, pdf, templates, service } = make()
    templates.getActiveHtmlWithFingerprint.mockResolvedValueOnce({ html: '<html>custom</html>', fingerprint: 'cafe' })
    withQueryResults(db, [{ id: 'x1', userId: 'u1', courseId: 'c1', code: 'ABC', studentName: 'Ana', courseTitle: 'Curso', hours: 2, cpf: '12345678900', status: 'issued', pdfPath: null, issuedAt: new Date() }])
    await service.getDocumentByCode('ABC')
    expect(pdf.generate).toHaveBeenCalledWith(expect.any(Object), '<html>custom</html>')
  })

  // ── Gate de quitação do carnê ──────────────────────────────────────────────

  describe('gate de quitação do carnê', () => {
    it('bloqueia a emissão com carnê em aberto', async () => {
      const { db, service } = make()
      withQueryResults(
        db,
        [course],
        [{ id: 'e1', source: 'purchase', orderId: 'ord_1', settledAt: null }] // matrícula ativa, pedido não quitado
      )
      await expect(service.issueOrGet(POLO_A, 'u1', 'curso')).rejects.toThrow(/quita/i)
      // Pina o leftJoin: o mock devolve a linha da fila não importa quais métodos do
      // builder foram chamados, então sem esta asserção o teste continuaria verde mesmo
      // se o leftJoin(orders, ...) fosse apagado do código — e o SQL quebraria em produção.
      expect(db.leftJoin).toHaveBeenCalledWith(orders, expect.anything())
    })

    it('NÃO bloqueia matrícula de cortesia com orderId órfão', async () => {
      // admin.service.ts (grantEnrollment) reativa com source 'free' mas NÃO zera o
      // orderId — ao contrário do checkout (checkout.service.ts), que zera. Um aluno com
      // compra cancelada que depois ganhou cortesia fica apontando para um pedido sem
      // settledAt. Sem a cláusula de `source`, este aluno perderia o certificado.
      const { db, service } = make()
      withQueryResults(
        db,
        [course],
        [{ id: 'e1', source: 'free', orderId: 'ord_cancelado', settledAt: null }],
        [{ total: 2, dur: 7200 }],
        [{ n: 2 }],
        [], // cert existente? não
        [{ uid: 'u1', displayName: 'Ana', email: 'a@x.com', cpf: '12345678900' }],
        undefined,
        undefined
      )
      await expect(service.issueOrGet(POLO_A, 'u1', 'curso')).resolves.toBeInstanceOf(Buffer)
      expect(db.leftJoin).toHaveBeenCalledWith(orders, expect.anything())
    })

    it('não bloqueia pedido à vista pago', async () => {
      const { db, service } = make()
      withQueryResults(
        db,
        [course],
        [{ id: 'e1', source: 'purchase', orderId: 'ord_1', settledAt: new Date() }],
        [{ total: 2, dur: 7200 }],
        [{ n: 2 }],
        [],
        [{ uid: 'u1', displayName: 'Ana', email: 'a@x.com', cpf: '12345678900' }],
        undefined,
        undefined
      )
      await expect(service.issueOrGet(POLO_A, 'u1', 'curso')).resolves.toBeInstanceOf(Buffer)
      expect(db.leftJoin).toHaveBeenCalledWith(orders, expect.anything())
    })

    it('não bloqueia matrícula sem pedido (orderId null)', async () => {
      const { db, service } = make()
      withQueryResults(
        db,
        [course],
        [{ id: 'e1', source: 'purchase', orderId: null, settledAt: null }],
        [{ total: 2, dur: 7200 }],
        [{ n: 2 }],
        [],
        [{ uid: 'u1', displayName: 'Ana', email: 'a@x.com', cpf: '12345678900' }],
        undefined,
        undefined
      )
      await expect(service.issueOrGet(POLO_A, 'u1', 'curso')).resolves.toBeInstanceOf(Buffer)
      expect(db.leftJoin).toHaveBeenCalledWith(orders, expect.anything())
    })
  })

  // ── settlementFor (status para a tela de certificado bloqueado) ────────────

  describe('settlementFor', () => {
    it('curso inexistente → 404', async () => {
      const { db, service } = make()
      withQueryResults(db, [])
      await expect(service.settlementFor(POLO_A, 'u1', 'nope')).rejects.toBeInstanceOf(NotFoundException)
    })

    it('sem matrícula ativa → 403', async () => {
      const { db, service } = make()
      withQueryResults(db, [course], [])
      await expect(service.settlementFor(POLO_A, 'u1', 'curso')).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('cortesia (source free) → settled true e sem carneUrl, mesmo com orderId órfão', async () => {
      const { db, service } = make()
      withQueryResults(db, [course], [{ source: 'free', orderId: 'ord_cancelado' }])
      const s = await service.settlementFor(POLO_A, 'u1', 'curso')
      expect(s).toEqual({ settled: true, paidCount: 0, totalCount: 0, carneUrl: null })
    })

    it('carnê em aberto → settled false, contagem de parcelas e carneUrl do proxy', async () => {
      const { db, installments, service } = make()
      installments.listForOrder.mockResolvedValueOnce([
        { installmentNumber: 1, valueInCents: 1000, status: 'paid', dueDate: '2026-01-01', paidAt: '2026-01-01T00:00:00.000Z' },
        { installmentNumber: 2, valueInCents: 1000, status: 'pending', dueDate: '2026-02-01', paidAt: null },
        { installmentNumber: 3, valueInCents: 1000, status: 'pending', dueDate: '2026-03-01', paidAt: null },
      ])
      withQueryResults(
        db,
        [course],
        [{ source: 'purchase', orderId: 'ord_1' }],
        [{ settledAt: null, installmentCount: 3, asaasInstallmentId: 'inst_1' }]
      )
      const s = await service.settlementFor(POLO_A, 'u1', 'curso')
      expect(s).toEqual({ settled: false, paidCount: 1, totalCount: 3, carneUrl: '/me/orders/ord_1/carne' })
    })

    it('carnê quitado → settled true', async () => {
      const { db, installments, service } = make()
      installments.listForOrder.mockResolvedValueOnce([
        { installmentNumber: 1, valueInCents: 1000, status: 'paid', dueDate: '2026-01-01', paidAt: '2026-01-01T00:00:00.000Z' },
      ])
      withQueryResults(
        db,
        [course],
        [{ source: 'purchase', orderId: 'ord_1' }],
        [{ settledAt: new Date(), installmentCount: 1, asaasInstallmentId: 'inst_1' }]
      )
      const s = await service.settlementFor(POLO_A, 'u1', 'curso')
      expect(s.settled).toBe(true)
    })

    it('pedido à vista/cartão (sem asaasInstallmentId) → sem carneUrl', async () => {
      const { db, service } = make()
      withQueryResults(db, [course], [{ source: 'purchase', orderId: 'ord_1' }], [{ settledAt: new Date(), installmentCount: null, asaasInstallmentId: null }])
      const s = await service.settlementFor(POLO_A, 'u1', 'curso')
      expect(s.carneUrl).toBeNull()
      expect(s.settled).toBe(true)
    })
  })

  // ── carneFor (proxy do carnê do Asaas) ──────────────────────────────────────

  describe('carneFor', () => {
    it('rejeita pedido de outro aluno (IDOR) sem chamar o Asaas', async () => {
      const { db, asaas, service } = make()
      withQueryResults(db, [{ userId: 'outro-aluno', asaasInstallmentId: 'inst_1' }])
      await expect(service.carneFor('t-a', 'u1', 'ord_de_outro')).rejects.toBeInstanceOf(NotFoundException)
      expect(asaas.getPaymentBook).not.toHaveBeenCalled()
    })

    it('pedido inexistente → 404 sem chamar o Asaas', async () => {
      const { db, asaas, service } = make()
      withQueryResults(db, [])
      await expect(service.carneFor('t-a', 'u1', 'nope')).rejects.toBeInstanceOf(NotFoundException)
      expect(asaas.getPaymentBook).not.toHaveBeenCalled()
    })

    it('carne de pedido de outro polo responde 404', async () => {
      const { db, asaas, service } = make()
      withQueryResults(db, [])
      await expect(service.carneFor('t-a', 'u1', 'o-de-outro')).rejects.toThrow('Pedido não encontrado.')
      expect(asaas.getPaymentBook).not.toHaveBeenCalled()
    })

    it('o filtro do polo está NA CONSULTA do pedido (o mock devolve [] de qualquer jeito)', async () => {
      // Sem esta asserção o teste acima passaria mesmo com o filtro apagado: quem prova que o
      // pedido de outro polo nem chega ao serviço é o SQL.
      const { db, service } = make()
      withQueryResults(db, [])
      await service.carneFor('t-a', 'u1', 'o-de-outro').catch(() => undefined)
      expect(allWheres(db.where)[0]).toEqual({
        sql: '(`orders`.`id` = ? and `orders`.`tenant_id` = ?)',
        params: ['o-de-outro', 't-a'],
      })
    })

    it('pedido sem carnê (asaasInstallmentId null) → 404 sem chamar o Asaas', async () => {
      const { db, asaas, service } = make()
      withQueryResults(db, [{ userId: 'u1', asaasInstallmentId: null }])
      await expect(service.carneFor('t-a', 'u1', 'ord_1')).rejects.toBeInstanceOf(NotFoundException)
      expect(asaas.getPaymentBook).not.toHaveBeenCalled()
    })

    it('pedido do próprio aluno → devolve o PDF do Asaas', async () => {
      const { db, asaas, service } = make()
      withQueryResults(db, [{ userId: 'u1', asaasInstallmentId: 'inst_1' }])
      const buf = await service.carneFor('t-a', 'u1', 'ord_1')
      expect(asaas.getPaymentBook).toHaveBeenCalledWith('inst_1')
      expect(buf.toString()).toContain('%PDF')
    })
  })

  describe('cache de PDF por versão do template', () => {
    it('mesmo template → serve o cache e NÃO re-renderiza', async () => {
      const { db, pdf, gcs, service, templates } = make()
      templates.getActiveHtmlWithFingerprint.mockResolvedValue({ html: '<h/>', fingerprint: 'v1' })
      gcs.readObject.mockResolvedValue({ buffer: Buffer.from('%PDF-cache-v1'), contentType: 'application/pdf' })
      withQueryResults(
        db, [course], [{ id: 'e1' }], [{ total: 2, dur: 7200 }], [{ n: 2 }],
        [{ id: 'c1', code: 'ABC', studentName: 'Ana', courseTitle: 'Curso', hours: 2, cpf: '12345678900', status: 'issued', pdfPath: 'certificates/c1/ABC-v1.pdf' }],
        [{ uid: 'u1', displayName: 'Ana', email: 'a@x.com', cpf: '12345678900' }]
      )
      const buf = await service.issueOrGet(POLO_A, 'u1', 'curso')
      expect(buf.toString()).toContain('%PDF-cache-v1')
      expect(pdf.generate).not.toHaveBeenCalled()
      expect(gcs.readObject).toHaveBeenCalledWith('certificates/c1/ABC-v1.pdf', { maxBytes: MAX_PDF_CACHE_BYTES })
    })

    it('template MUDOU → ignora o cache, re-renderiza e apaga o PDF da versão antiga', async () => {
      // Este é o bug que motivou a mudança: o layout foi corrigido no arquivo e publicado,
      // mas o caminho do cache não dependia do template, então o aluno seguia baixando o
      // PDF antigo. `invalidatePdfCache` só roda quando o admin salva pelo editor.
      const { db, pdf, gcs, service, templates } = make()
      templates.getActiveHtmlWithFingerprint.mockResolvedValue({ html: '<h2/>', fingerprint: 'v2' })
      gcs.readObject.mockResolvedValue({ buffer: Buffer.from('%PDF-cache-v1'), contentType: 'application/pdf' })
      withQueryResults(
        db, [course], [{ id: 'e1' }], [{ total: 2, dur: 7200 }], [{ n: 2 }],
        [{ id: 'c1', code: 'ABC', studentName: 'Ana', courseTitle: 'Curso', hours: 2, cpf: '12345678900', status: 'issued', pdfPath: 'certificates/c1/ABC-v1.pdf' }],
        [{ uid: 'u1', displayName: 'Ana', email: 'a@x.com', cpf: '12345678900' }]
      )
      const buf = await service.issueOrGet(POLO_A, 'u1', 'curso')
      expect(pdf.generate).toHaveBeenCalled()
      expect(buf.toString()).toContain('%PDF-mock')
      // grava no caminho da versão nova
      expect(gcs.saveObject).toHaveBeenCalledWith('certificates/c1/ABC-v2.pdf', expect.anything(), 'application/pdf')
      // e limpa o órfão da versão anterior
      expect(gcs.deleteObject).toHaveBeenCalledWith('certificates/c1/ABC-v1.pdf')
    })

    it('certificado LEGADO (caminho sem fingerprint) → re-renderiza', async () => {
      const { db, pdf, service, templates } = make()
      templates.getActiveHtmlWithFingerprint.mockResolvedValue({ html: '<h/>', fingerprint: 'v1' })
      withQueryResults(
        db, [course], [{ id: 'e1' }], [{ total: 2, dur: 7200 }], [{ n: 2 }],
        [{ id: 'c1', code: 'ABC', studentName: 'Ana', courseTitle: 'Curso', hours: 2, cpf: '12345678900', status: 'issued', pdfPath: 'certificates/c1/ABC.pdf' }],
        [{ uid: 'u1', displayName: 'Ana', email: 'a@x.com', cpf: '12345678900' }]
      )
      await service.issueOrGet(POLO_A, 'u1', 'curso')
      expect(pdf.generate).toHaveBeenCalled()
    })
  })
})

describe('coordenador (2ª assinatura)', () => {
  const comCoord = { ...course, coordinatorName: 'Jane Veck', coordinatorRole: 'Coordenadora do Curso' }

  it('emissão CONGELA o coordenador do curso no snapshot', async () => {
    const { db, service } = make()
    withQueryResults(
      db,
      [comCoord], [{ id: 'e1' }], [{ total: 2, dur: 7200 }], [{ n: 2 }], [],
      [{ uid: 'u1', displayName: 'Ana', email: 'a@x.com', cpf: '12345678900' }],
      undefined, undefined
    )
    await service.issueOrGet(POLO_A, 'u1', 'curso')
    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({ coordinatorName: 'Jane Veck', coordinatorRole: 'Coordenadora do Curso' })
    )
  })

  it('curso SEM coordenador grava null (certificado sai só com a Diretora)', async () => {
    const { db, service } = make()
    withQueryResults(
      db,
      [course], [{ id: 'e1' }], [{ total: 2, dur: 7200 }], [{ n: 2 }], [],
      [{ uid: 'u1', displayName: 'Ana', email: 'a@x.com', cpf: '12345678900' }],
      undefined, undefined
    )
    await service.issueOrGet(POLO_A, 'u1', 'curso')
    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ coordinatorName: null }))
  })

  it('o PDF acompanha o coordenador ATUAL do curso (corrigir o nome chega ao aluno)', async () => {
    const { db, pdf, service } = make()
    withQueryResults(
      db,
      [{ ...comCoord, coordinatorName: 'Coordenador NOVO' }],
      [{ id: 'e1' }], [{ total: 2, dur: 7200 }], [{ n: 2 }],
      [{ id: 'x1', code: 'ABC', studentName: 'Ana', courseTitle: 'Curso', hours: 2, cpf: '12345678900',
         coordinatorName: 'Jane Veck', coordinatorRole: 'Coordenadora do Curso',
         status: 'issued', pdfPath: null, issuedAt: new Date() }],
      [{ uid: 'u1', displayName: 'Ana', email: 'a@x.com', cpf: '12345678900' }],
      undefined
    )
    await service.issueOrGet(POLO_A, 'u1', 'curso')
    expect(pdf.generate).toHaveBeenCalledWith(
      expect.objectContaining({ coordinatorName: 'Coordenador NOVO' }), expect.any(String)
    )
  })
})

describe('preenchimento do coordenador em certificado já emitido', () => {
  it('certificado SAUDÁVEL sem coordenador → preenche do curso e invalida o PDF cacheado', async () => {
    const { db, gcs, service } = make()
    withQueryResults(
      db,
      [{ ...course, coordinatorName: 'Jane Veck', coordinatorRole: 'Coordenadora do Curso' }],
      [{ id: 'e1' }], [{ total: 2, dur: 7200 }], [{ n: 2 }],
      [{ id: 'x1', code: 'ABC', studentName: 'Ana', courseTitle: 'Curso', hours: 2, cpf: '12345678900',
         coordinatorName: null, status: 'issued', pdfPath: 'certificates/x1/ABC-v1.pdf', issuedAt: new Date() }],
      [{ uid: 'u1', displayName: 'Ana', email: 'a@x.com', cpf: '12345678900' }], // cadastro, lido na reemissão para ressincronizar o nome
      undefined
    )
    await service.issueOrGet(POLO_A, 'u1', 'curso')
    const set = db.update.mock.results[0].value.set.mock.calls[0][0]
    expect(set.coordinatorName).toBe('Jane Veck')
    // sem invalidar as duas caches, o PDF antigo volta SEM a assinatura
    expect(set.pdfPath).toBeNull()
    expect(gcs.deleteObject).toHaveBeenCalled()
  })

  it('curso SEM coordenador NÃO desassina certificado já emitido', async () => {
    // Esta é a garantia que sobra do congelamento: sincronizar com o curso não pode virar
    // "limpar o cadastro apaga a assinatura do diploma que o aluno já tem na mão".
    const { db, pdf, service } = make()
    withQueryResults(
      db,
      [{ ...course, coordinatorName: null, coordinatorRole: null, coordinatorSignaturePath: null }],
      [{ id: 'e1' }], [{ total: 2, dur: 7200 }], [{ n: 2 }],
      [{ id: 'x1', code: 'ABC', studentName: 'Ana', courseTitle: 'Curso', hours: 2, cpf: '12345678900',
         coordinatorName: 'Jane Veck', coordinatorRole: 'Coordenadora do Curso',
         status: 'issued', pdfPath: 'certificates/x1/ABC-v1.pdf', issuedAt: new Date() }],
      [{ uid: 'u1', displayName: 'Ana', email: 'a@x.com', cpf: '12345678900' }], // cadastro, lido na reemissão para ressincronizar o nome
      undefined
    )
    await service.issueOrGet(POLO_A, 'u1', 'curso')
    // `db.update` também é usado pelo ensurePdf para gravar o caminho do PDF — o que não
    // pode existir é gravação MEXENDO no coordenador.
    const gravacoes = db.set.mock.calls.map((c) => c[0] as Record<string, unknown>)
    expect(gravacoes.some((g) => 'coordinatorName' in g)).toBe(false)
    expect(pdf.generate).toHaveBeenCalledWith(
      expect.objectContaining({ coordinatorName: 'Jane Veck' }), expect.any(String)
    )
  })

  it('nome CORRIGIDO no curso é gravado no snapshot e invalida o PDF cacheado', async () => {
    const { db, service } = make()
    withQueryResults(
      db,
      [{ ...course, coordinatorName: 'Jane Veck Souza', coordinatorRole: 'Coordenadora do Curso' }],
      [{ id: 'e1' }], [{ total: 2, dur: 7200 }], [{ n: 2 }],
      [{ id: 'x1', code: 'ABC', studentName: 'Ana', courseTitle: 'Curso', hours: 2, cpf: '12345678900',
         coordinatorName: 'Jane Veck', coordinatorRole: 'Coordenadora do Curso',
         status: 'issued', pdfPath: 'certificates/x1/ABC-v1.pdf', issuedAt: new Date() }],
      [{ uid: 'u1', displayName: 'Ana', email: 'a@x.com', cpf: '12345678900' }], // cadastro, lido na reemissão para ressincronizar o nome
      undefined
    )
    await service.issueOrGet(POLO_A, 'u1', 'curso')
    const set = db.update.mock.results[0].value.set.mock.calls[0][0]
    expect(set.coordinatorName).toBe('Jane Veck Souza')
    expect(set.pdfPath).toBeNull()
  })
})

describe('rubrica (imagem) do coordenador', () => {
  const comRubrica = {
    ...course,
    coordinatorName: 'Jane Veck',
    coordinatorRole: 'Coordenadora do Curso',
    coordinatorSignaturePath: 'cursos/c1/signature/abc.png',
  }

  it('emissão congela o CAMINHO da rubrica', async () => {
    const { db, service } = make()
    withQueryResults(
      db,
      [comRubrica], [{ id: 'e1' }], [{ total: 2, dur: 7200 }], [{ n: 2 }], [],
      [{ uid: 'u1', displayName: 'Ana', email: 'a@x.com', cpf: '12345678900' }],
      undefined, undefined
    )
    await service.issueOrGet(POLO_A, 'u1', 'curso')
    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({ coordinatorSignaturePath: 'cursos/c1/signature/abc.png' })
    )
  })

  it('a rubrica vira data URI no render (o sandbox do renderizador recusa URL externa)', async () => {
    const { db, gcs, pdf, service } = make()
    gcs.readObject.mockResolvedValue({ buffer: Buffer.from('PNGBYTES'), contentType: 'image/png' })
    withQueryResults(
      db,
      [comRubrica], [{ id: 'e1' }], [{ total: 2, dur: 7200 }], [{ n: 2 }],
      [{ id: 'x1', courseId: 'c1', code: 'ABC', studentName: 'Ana', courseTitle: 'Curso', hours: 2, cpf: '12345678900',
         coordinatorName: 'Jane Veck', coordinatorRole: 'Coordenadora do Curso',
         coordinatorSignaturePath: 'cursos/c1/signature/abc.png',
         status: 'issued', pdfPath: null, issuedAt: new Date() }],
      [{ uid: 'u1', displayName: 'Ana', email: 'a@x.com', cpf: '12345678900' }], // cadastro, lido na reemissão para ressincronizar o nome
      undefined
    )
    await service.issueOrGet(POLO_A, 'u1', 'curso')
    expect(pdf.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        coordinatorSignatureDataUri: `data:image/png;base64,${Buffer.from('PNGBYTES').toString('base64')}`,
      }),
      expect.any(String)
    )
  })

  it('rubrica sumida do GCS não impede a emissão — sai sem a imagem', async () => {
    // Certificado sem assinatura é ruim; certificado que NÃO SAI é pior.
    const { db, gcs, pdf, service } = make()
    gcs.readObject.mockResolvedValue(null)
    withQueryResults(
      db,
      [comRubrica], [{ id: 'e1' }], [{ total: 2, dur: 7200 }], [{ n: 2 }],
      [{ id: 'x1', courseId: 'c1', code: 'ABC', studentName: 'Ana', courseTitle: 'Curso', hours: 2, cpf: '12345678900',
         coordinatorName: 'Jane Veck', coordinatorSignaturePath: 'cursos/c1/signature/sumiu.png',
         status: 'issued', pdfPath: null, issuedAt: new Date() }],
      [{ uid: 'u1', displayName: 'Ana', email: 'a@x.com', cpf: '12345678900' }], // cadastro, lido na reemissão para ressincronizar o nome
      undefined
    )
    await service.issueOrGet(POLO_A, 'u1', 'curso')
    // a leitura foi TENTADA (o caminho é do próprio curso) e o GCS não devolveu nada
    expect(gcs.readObject).toHaveBeenCalledWith('cursos/c1/signature/abc.png', { maxBytes: MAX_IMAGE_BYTES })
    expect(pdf.generate).toHaveBeenCalledWith(
      expect.objectContaining({ coordinatorSignatureDataUri: undefined }), expect.any(String)
    )
  })

  it('certificado que JÁ tem nome mas não tem rubrica recebe a rubrica e invalida o PDF', async () => {
    // A rubrica costuma chegar depois do nome: se o preenchimento dependesse de o nome
    // estar vazio, este caso — o comum — ficaria de fora para sempre.
    const { db, service } = make()
    withQueryResults(
      db,
      [comRubrica], [{ id: 'e1' }], [{ total: 2, dur: 7200 }], [{ n: 2 }],
      [{ id: 'x1', code: 'ABC', studentName: 'Ana', courseTitle: 'Curso', hours: 2, cpf: '12345678900',
         coordinatorName: 'Jane Veck', coordinatorRole: 'Coordenadora do Curso',
         coordinatorSignaturePath: null,
         status: 'issued', pdfPath: 'certificates/x1/ABC-v1.pdf', issuedAt: new Date() }],
      [{ uid: 'u1', displayName: 'Ana', email: 'a@x.com', cpf: '12345678900' }], // cadastro, lido na reemissão para ressincronizar o nome
      undefined
    )
    await service.issueOrGet(POLO_A, 'u1', 'curso')
    const set = db.update.mock.results[0].value.set.mock.calls[0][0]
    expect(set.coordinatorSignaturePath).toBe('cursos/c1/signature/abc.png')
    expect(set.pdfPath).toBeNull()
    // e o nome continua o mesmo (a sincronização grava os três campos, mas com o valor
    // do curso — que aqui é igual ao que já estava)
    expect(set.coordinatorName).toBe('Jane Veck')
  })
})

describe('validação pública × rubrica', () => {
  it('snapshot sem rubrica cai no curso — a página pública mostra o MESMO documento', async () => {
    // Sem isto, quem valida pelo QR vê o certificado sem assinatura enquanto o aluno,
    // baixando pela conta, vê com ela. Dois documentos para o mesmo código.
    const { db, gcs, pdf, service } = make()
    gcs.readObject.mockImplementation((async (p: string) =>
      p && p.endsWith('.png') ? { buffer: Buffer.from('PNG'), contentType: 'image/png' } : null) as never
    )
    withQueryResults(
      db,
      [{ id: 'x1', courseId: 'c1', code: 'ABC', studentName: 'Ana', courseTitle: 'Curso', hours: 2,
         cpf: '12345678900', coordinatorName: 'Jane Veck', coordinatorSignaturePath: null,
         status: 'issued', pdfPath: null, issuedAt: new Date() }],
      [{ name: 'Jane Veck', role: 'Coordenadora do Curso', signaturePath: 'cursos/c1/signature/jane.png' }]
    )
    await service.getDocumentByCode('ABC')
    expect(pdf.generate).toHaveBeenCalledWith(
      expect.objectContaining({ coordinatorSignatureDataUri: expect.stringContaining('data:image/png') }),
      expect.any(String)
    )
  })

  it('snapshot COM rubrica ignora o curso (documento emitido não muda)', async () => {
    const { db, gcs, pdf, service } = make()
    gcs.readObject.mockImplementation((async (p: string) =>
      p === 'cursos/c1/signature/congelada.png' ? { buffer: Buffer.from('ANTIGA'), contentType: 'image/png' } : null) as never
    )
    withQueryResults(
      db,
      [{ id: 'x1', courseId: 'c1', code: 'ABC', studentName: 'Ana', courseTitle: 'Curso', hours: 2,
         cpf: '12345678900', coordinatorName: 'Jane Veck', coordinatorSignaturePath: 'cursos/c1/signature/congelada.png',
         status: 'issued', pdfPath: null, issuedAt: new Date() }]
    )
    await service.getDocumentByCode('ABC')
    expect(pdf.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        coordinatorSignatureDataUri: `data:image/png;base64,${Buffer.from('ANTIGA').toString('base64')}`,
      }),
      expect.any(String)
    )
  })
})

it('a chave do cache público muda quando a rubrica muda (senão o PDF velho fica para sempre)', async () => {
  // O fingerprint sozinho cobre só o TEMPLATE. Cadastrar a rubrica depois não mudaria o
  // caminho, e a validação pública continuaria servindo o PDF sem assinatura. Aconteceu.
  async function caminhoSalvo(assinaturaDoCurso: string | null): Promise<string> {
    const { db, gcs, service } = make()
    withQueryResults(
      db,
      [{ id: 'x1', courseId: 'c1', code: 'ABC', studentName: 'Ana', courseTitle: 'Curso', hours: 2,
         cpf: '12345678900', coordinatorName: 'Jane', coordinatorSignaturePath: null,
         status: 'issued', pdfPath: null, issuedAt: new Date() }],
      [{ name: 'Jane', role: null, signaturePath: assinaturaDoCurso }]
    )
    await service.getDocumentByCode('ABC')
    return (gcs.saveObject.mock.calls[0] as unknown[])[0] as string
  }
  const sem = await caminhoSalvo(null)
  const com = await caminhoSalvo('cursos/c1/signature/jane.png')
  expect(com).not.toBe(sem)
})

describe('emissão pelo admin', () => {
  const semProgresso = (comAlgumProgresso = 0) =>
    [
      [course], [{ id: 'e1' }], [{ total: 5, dur: 7200 }], [{ n: comAlgumProgresso }], [],
      [{ uid: 'u1', displayName: 'Ana', email: 'a@x.com', cpf: '12345678900' }],
      undefined, undefined,
    ] as unknown[]

  it('aluno comum sem 100% → barrado', async () => {
    const { db, service } = make()
    withQueryResults(db, ...(semProgresso(2) as never[]))
    await expect(service.issueOrGet(POLO_A, 'u1', 'curso')).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('admin emite mesmo sem 100% e sem provas', async () => {
    // É a instituição decidindo certificar alguém que o sistema barraria — o caso real é
    // ter concluído sem o sistema registrar.
    const { db, quiz, service } = make()
    withQueryResults(db, ...(semProgresso(2) as never[]))
    const pdf = await service.issueOrGet(POLO_A, 'u1', 'curso', undefined, undefined, true)
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    // nem chega a consultar as provas
    expect(quiz.allModuleQuizzesPassed).not.toHaveBeenCalled()
  })

  it('admin NÃO pula a matrícula ativa — sem ela não há o que certificar', async () => {
    const { db, service } = make()
    withQueryResults(db, [course], [])
    await expect(service.issueOrGet(POLO_A, 'u1', 'curso', undefined, undefined, true)).rejects.toBeInstanceOf(
      ForbiddenException
    )
  })

  it('admin pula o gate do carnê em aberto', async () => {
    const { db, service } = make()
    withQueryResults(
      db,
      [course],
      [{ id: 'e1', source: 'purchase', orderId: 'o1', settledAt: null }], // carnê em aberto
      [{ total: 5, dur: 7200 }], [{ n: 5 }], [],
      [{ uid: 'u1', displayName: 'Ana', email: 'a@x.com', cpf: '12345678900' }],
      undefined, undefined
    )
    const pdf = await service.issueOrGet(POLO_A, 'u1', 'curso', undefined, undefined, true)
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  })
})

describe('carga horária definida no curso', () => {
  it('vence a soma da duração das aulas', async () => {
    // 180h de curso não são 180h de aula gravada — a carga declarada é outra coisa.
    const { db, pdf, service } = make()
    withQueryResults(
      db,
      [{ ...course, workloadHours: 180 }],
      [{ id: 'e1' }], [{ total: 2, dur: 7200 }], [{ n: 2 }], [],
      [{ uid: 'u1', displayName: 'Ana', email: 'a@x.com', cpf: '12345678900' }],
      undefined, undefined
    )
    await service.issueOrGet(POLO_A, 'u1', 'curso')
    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ hours: 180 }))
    void pdf
  })

  it('sem carga definida, continua somando as aulas (comportamento de sempre)', async () => {
    const { db, service } = make()
    withQueryResults(
      db,
      [{ ...course, workloadHours: null }],
      [{ id: 'e1' }], [{ total: 2, dur: 7200 }], [{ n: 2 }], [],
      [{ uid: 'u1', displayName: 'Ana', email: 'a@x.com', cpf: '12345678900' }],
      undefined, undefined
    )
    await service.issueOrGet(POLO_A, 'u1', 'curso')
    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ hours: 2 }))
  })

  it('nunca imprime 0 horas', async () => {
    // Curso sem duração cadastrada arredondaria para zero, e "0 horas" no diploma é pior
    // que um arredondado para cima.
    const { db, service } = make()
    withQueryResults(
      db,
      [{ ...course, workloadHours: null }],
      [{ id: 'e1' }], [{ total: 2, dur: 60 }], [{ n: 2 }], [],
      [{ uid: 'u1', displayName: 'Ana', email: 'a@x.com', cpf: '12345678900' }],
      undefined, undefined
    )
    await service.issueOrGet(POLO_A, 'u1', 'curso')
    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ hours: 1 }))
  })

  it('CORRIGIR a carga chega ao certificado já emitido', async () => {
    const { db, service } = make()
    withQueryResults(
      db,
      [{ ...course, workloadHours: 180 }],
      [{ id: 'e1' }], [{ total: 2, dur: 7200 }], [{ n: 2 }],
      [{ id: 'x1', code: 'ABC', studentName: 'Ana', courseTitle: 'Curso', hours: 2, cpf: '12345678900',
         status: 'issued', pdfPath: 'certificates/x1/ABC-v1.pdf', issuedAt: new Date() }],
      [{ uid: 'u1', displayName: 'Ana', email: 'a@x.com', cpf: '12345678900' }], // cadastro, lido na reemissão para ressincronizar o nome
      undefined
    )
    await service.issueOrGet(POLO_A, 'u1', 'curso')
    const set = db.update.mock.results[0].value.set.mock.calls[0][0]
    expect(set.hours).toBe(180)
    expect(set.pdfPath).toBeNull()
  })
})

describe('título do curso', () => {
  it('RENOMEAR o curso chega ao certificado já emitido', async () => {
    // Mesmo critério da carga e do coordenador: quem renomeia o curso está corrigindo o
    // documento, e o certificado reemitido tem que sair com o nome atual.
    const { db, service } = make()
    withQueryResults(
      db,
      [{ ...course, title: 'Introdução a Grafologia' }],
      [{ id: 'e1' }], [{ total: 2, dur: 7200 }], [{ n: 2 }],
      [{ id: 'x1', code: 'ABC', studentName: 'Ana', courseTitle: 'Grafologia - A Ciência que Analisa o Comportamento Humano', hours: 2, cpf: '12345678900',
         status: 'issued', pdfPath: 'certificates/x1/ABC-v1.pdf', issuedAt: new Date() }],
      [{ uid: 'u1', displayName: 'Ana', email: 'a@x.com', cpf: '12345678900' }], // cadastro, lido na reemissão para ressincronizar o nome
      undefined
    )
    await service.issueOrGet(POLO_A, 'u1', 'curso')
    const set = db.update.mock.results[0].value.set.mock.calls[0][0]
    expect(set.courseTitle).toBe('Introdução a Grafologia')
    expect(set.pdfPath).toBeNull()
  })

  it('curso com o MESMO título não regrava o snapshot', async () => {
    // Sincronizar não pode virar invalidação gratuita: sem mudança, nenhum UPDATE de
    // snapshot acontece (o único update permitido é o do pdfPath, ao gravar o PDF).
    const { db, service } = make()
    withQueryResults(
      db,
      [{ ...course, title: 'Curso' }],
      [{ id: 'e1' }], [{ total: 2, dur: 7200 }], [{ n: 2 }],
      [{ id: 'x1', code: 'ABC', studentName: 'Ana', courseTitle: 'Curso', hours: 2, cpf: '12345678900',
         status: 'issued', pdfPath: 'certificates/x1/ABC-v1.pdf', issuedAt: new Date() }],
      [{ uid: 'u1', displayName: 'Ana', email: 'a@x.com', cpf: '12345678900' }], // cadastro, lido na reemissão para ressincronizar o nome
      undefined
    )
    await service.issueOrGet(POLO_A, 'u1', 'curso')
    const gravacoes = db.update.mock.results.map((r) => r.value.set.mock.calls[0][0] as Record<string, unknown>)
    expect(gravacoes.some((g) => 'courseTitle' in g)).toBe(false)
  })
})

describe('nome do aluno no cadastro', () => {
  const certValdirene = {
    id: 'x1', code: 'ABC', studentName: 'Valdirene de Fátima Lell Candido', courseTitle: 'Curso', hours: 2,
    cpf: '12345678900', status: 'issued', pdfPath: 'certificates/x1/ABC-v1.pdf', issuedAt: new Date(),
  }

  it('nome CORRIGIDO no cadastro chega ao certificado já emitido', async () => {
    // Caso real (09/09/2026): a conta da aluna estava com o nome de outra pessoa quando o
    // certificado foi emitido pela primeira vez. O admin corrigiu o cadastro e reemitiu
    // várias vezes — e o documento continuava saindo com o nome errado, porque o snapshot
    // só era reparado quando o nome estava vazio ou era um e-mail. Mesmo critério do
    // título: só o admin edita nome, a edição é auditada, e correção que não chega ao
    // certificado não corrigiu nada.
    const { db, gcs, service } = make()
    withQueryResults(
      db,
      [course], [{ id: 'e1' }], [{ total: 2, dur: 7200 }], [{ n: 2 }],
      [certValdirene],
      [{ uid: 'u1', displayName: 'Valeria de Fátima Lell Alves Leite', email: 'f@x.com', cpf: '12345678900' }],
      undefined
    )
    await service.issueOrGet(POLO_A, 'u1', 'curso')
    const set = db.update.mock.results[0].value.set.mock.calls[0][0]
    expect(set.studentName).toBe('Valeria de Fátima Lell Alves Leite')
    // sem invalidar as duas caches, o PDF antigo volta com o nome errado
    expect(set.pdfPath).toBeNull()
    expect(gcs.deleteObject).toHaveBeenCalled()
  })

  it('cadastro SEM nome válido não apaga o nome do snapshot', async () => {
    // Sincronizar não pode virar "limpar o cadastro apaga o nome do diploma": sem nome
    // válido no cadastro, o documento continua como foi emitido.
    const { db, pdf, service } = make()
    withQueryResults(
      db,
      [course], [{ id: 'e1' }], [{ total: 2, dur: 7200 }], [{ n: 2 }],
      [certValdirene],
      [{ uid: 'u1', displayName: null, email: 'f@x.com', cpf: '12345678900' }],
      undefined
    )
    await service.issueOrGet(POLO_A, 'u1', 'curso')
    const gravacoes = db.set.mock.calls.map((c) => c[0] as Record<string, unknown>)
    expect(gravacoes.some((g) => 'studentName' in g)).toBe(false)
    expect(pdf.generate).toHaveBeenCalledWith(
      expect.objectContaining({ studentName: 'Valdirene de Fátima Lell Candido' }), expect.any(String)
    )
  })

  it('cadastro com o MESMO nome não regrava o snapshot', async () => {
    const { db, service } = make()
    withQueryResults(
      db,
      [course], [{ id: 'e1' }], [{ total: 2, dur: 7200 }], [{ n: 2 }],
      [certValdirene],
      [{ uid: 'u1', displayName: '  Valdirene de Fátima   Lell Candido ', email: 'f@x.com', cpf: '12345678900' }],
      undefined
    )
    await service.issueOrGet(POLO_A, 'u1', 'curso')
    const gravacoes = db.set.mock.calls.map((c) => c[0] as Record<string, unknown>)
    expect(gravacoes.some((g) => 'studentName' in g)).toBe(false)
  })
})

describe('PDF público (QR) × snapshot ressincronizado', () => {
  const base = { id: 'x1', userId: 'u1', courseId: 'c1', code: 'ABC', courseTitle: 'Curso', hours: 2, cpf: '12345678900', status: 'issued', pdfPath: null, issuedAt: new Date() }
  const pathSalvo = (gcs: ReturnType<typeof make>['gcs']) => (gcs.saveObject.mock.calls[0] as unknown[])[0] as string

  it('nome do aluno corrigido muda a chave do cache público', async () => {
    // A chave só cobria template e coordenador: corrigir o nome no snapshot não mudava o
    // caminho e quem validava pelo QR recebia o PDF antigo para sempre.
    const a = make()
    withQueryResults(a.db, [{ ...base, studentName: 'Valdirene de Fátima Lell Candido' }], [])
    await a.service.getDocumentByCode('ABC')
    const b = make()
    withQueryResults(b.db, [{ ...base, studentName: 'Valeria de Fátima Lell Alves Leite' }], [])
    await b.service.getDocumentByCode('ABC')
    expect(pathSalvo(a.gcs)).not.toBe(pathSalvo(b.gcs))
  })

  it('título do curso corrigido muda a chave do cache público', async () => {
    const a = make()
    withQueryResults(a.db, [{ ...base, studentName: 'Ana', courseTitle: 'Grafologia' }], [])
    await a.service.getDocumentByCode('ABC')
    const b = make()
    withQueryResults(b.db, [{ ...base, studentName: 'Ana', courseTitle: 'Introdução a Grafologia' }], [])
    await b.service.getDocumentByCode('ABC')
    expect(pathSalvo(a.gcs)).not.toBe(pathSalvo(b.gcs))
  })
})

describe('listMine: certificados do polo do endereço', () => {
  it('listMine traz só certificados de cursos do polo', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    await service.listMine('t-a', 'u1')
    const w = allWheres(db.where)[0]
    expect(w.sql).toContain('`courses`.`tenant_id` = ?')
    expect(w.params).toEqual(['u1', 't-a'])
  })

  it('o snapshot manda no título; sem snapshot, vale o do curso', async () => {
    const { db, service } = make()
    withQueryResults(db, [
      { code: 'A1', courseTitle: 'Título impresso', hours: 40, issuedAt: new Date('2026-09-01T12:00:00Z'), status: 'issued', slug: 'excel', title: 'Título novo' },
      { code: 'B2', courseTitle: null, hours: null, issuedAt: null, status: 'revoked', slug: 'word', title: 'Word' },
    ])
    expect(await service.listMine('t-a', 'u1')).toEqual([
      { code: 'A1', courseSlug: 'excel', courseTitle: 'Título impresso', hours: 40, issuedAt: '2026-09-01T12:00:00.000Z', status: 'issued' },
      { code: 'B2', courseSlug: 'word', courseTitle: 'Word', hours: null, issuedAt: null, status: 'revoked' },
    ])
  })
})

describe('o titular recebe o certificado mesmo depois que o curso mudou (CA-2)', () => {
  const cert = {
    id: 'cert1', code: 'ABC', userId: 'u1', courseId: 'c1', studentName: 'Ana Maria', courseTitle: 'Curso', hours: 1, cpf: '12345678900',
    coordinatorName: null, coordinatorRole: null, coordinatorSignaturePath: null, status: 'issued', pdfPath: null, issuedAt: new Date(),
  }
  const matricula = [{ id: 'e1', source: 'free', orderId: null, settledAt: null }]
  const aluna = [{ uid: 'u1', displayName: 'Ana Maria', cpf: '12345678900' }]

  it('aula nova que o titular não fez: reemite em vez de cobrar 100%', async () => {
    const { db, service } = make()
    // [curso], [matrícula], [aulas: agora 3], [concluídas: 2], [certificado: já tem], [aluna], [pdfPath]
    withQueryResults<unknown>(db, [course], matricula, [{ total: 3, dur: 3600 }], [{ n: 2 }], [cert], aluna, undefined)
    await expect(service.issueOrGet(POLO_A, 'u1', 'curso')).resolves.toBeInstanceOf(Buffer)
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('prova nova que o titular não fez: reemite em vez de cobrar a aprovação', async () => {
    const { db, quiz, service } = make()
    quiz.allModuleQuizzesPassed.mockResolvedValueOnce(false)
    withQueryResults<unknown>(db, [course], matricula, [{ total: 2, dur: 3600 }], [{ n: 2 }], [cert], aluna, undefined)
    await expect(service.issueOrGet(POLO_A, 'u1', 'curso')).resolves.toBeInstanceOf(Buffer)
  })

  it('curso que ficou sem aula: o titular ainda recebe o dele', async () => {
    const { db, service } = make()
    // sem aula não há o que contar: [curso], [matrícula], [aulas: 0], [certificado], [aluna], [pdfPath]
    withQueryResults<unknown>(db, [course], matricula, [{ total: 0, dur: null }], [cert], aluna, undefined)
    await expect(service.issueOrGet(POLO_A, 'u1', 'curso')).resolves.toBeInstanceOf(Buffer)
  })

  it('sem certificado, a pendência é cobrada como antes: aula por fazer, prova reprovada, curso sem aula', async () => {
    const aula = make()
    withQueryResults<unknown>(aula.db, [course], matricula, [{ total: 3, dur: 3600 }], [{ n: 2 }], [])
    await expect(aula.service.issueOrGet(POLO_A, 'u1', 'curso')).rejects.toThrow('Conclua 100% do curso para emitir o certificado.')

    const prova = make()
    prova.quiz.allModuleQuizzesPassed.mockResolvedValueOnce(false)
    withQueryResults<unknown>(prova.db, [course], matricula, [{ total: 2, dur: 3600 }], [{ n: 2 }], [])
    await expect(prova.service.issueOrGet(POLO_A, 'u1', 'curso')).rejects.toThrow('Você precisa ser aprovado em todas as provas do curso.')

    const vazio = make()
    withQueryResults<unknown>(vazio.db, [course], matricula, [{ total: 0, dur: null }], [])
    await expect(vazio.service.issueOrGet(POLO_A, 'u1', 'curso')).rejects.toThrow('Curso sem aulas.')
    for (const m of [aula, prova, vazio]) expect(m.db.insert).not.toHaveBeenCalled()
  })

  it('a matrícula ativa continua exigida do titular', async () => {
    const { db, service } = make()
    withQueryResults<unknown>(db, [course], [])
    await expect(service.issueOrGet(POLO_A, 'u1', 'curso')).rejects.toThrow('Este aluno precisa ter matrícula ativa no curso.')
  })
})

describe('curso resolvido pelo polo do endereço', () => {
  it('issueOrGet busca o curso pelo slug DENTRO do polo (a situação do curso é decidida depois)', async () => {
    const { db, scope, quiz, service } = make()
    const bySlug = jest.spyOn(scope, 'bySlug')
    withQueryResults(db, [])
    await expect(service.issueOrGet(POLO_A, 'u1', 'excel-basico')).rejects.toThrow('Curso não encontrado.')
    expect(bySlug).toHaveBeenCalledWith('t-a', 'excel-basico')
    expect(allWheres(db.where)[0].params).toEqual(['t-a', 'excel-basico'])
    // sem curso do polo não há o que consultar, gravar nem emitir
    expect(db.insert).not.toHaveBeenCalled()
    expect(quiz.allModuleQuizzesPassed).not.toHaveBeenCalled()
  })

  it('issueOrGet: slug que só existe em OUTRO polo → 404 até para quem emite sem requisitos', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    await expect(service.issueOrGet(POLO_A, 'u1', 'so-no-b', undefined, undefined, true)).rejects.toBeInstanceOf(NotFoundException)
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('settlementFor busca o curso pelo slug DENTRO do polo (a situação do curso é decidida depois)', async () => {
    const { db, scope, service } = make()
    const bySlug = jest.spyOn(scope, 'bySlug')
    withQueryResults(db, [])
    await expect(service.settlementFor(POLO_A, 'u1', 'excel-basico')).rejects.toThrow('Curso não encontrado.')
    expect(bySlug).toHaveBeenCalledWith('t-a', 'excel-basico')
    expect(allWheres(db.where)[0].params).toEqual(['t-a', 'excel-basico'])
  })

  describe('curso fora do ar', () => {
    const foraDoAr = { ...course, status: 'draft' }
    const AVISO_POLO = { statusCode: 403, code: 'COURSE_UNAVAILABLE', message: 'Este curso está indisponível no momento. Fale com o seu polo.' }

    it('o titular de um certificado já emitido segue vendo o status (a matrícula ativa continua exigida)', async () => {
      const { db, service } = make()
      // [curso], [certificado do aluno?], [matrícula ativa (do status)]
      withQueryResults(db, [foraDoAr], [{ id: 'cert1' }], [{ source: 'free', orderId: null }])
      expect(await service.settlementFor(POLO_A, 'u1', 'curso')).toEqual({ settled: true, paidCount: 0, totalCount: 0, carneUrl: null })
      expect(allWheres(db.where)[1]).toEqual({ sql: '(`certificates`.`user_id` = ? and `certificates`.`course_id` = ?)', params: ['u1', 'c1'] })
    })

    it('o titular segue baixando o PDF: o fluxo de reemissão continua do mesmo jeito', async () => {
      const { db, service } = make()
      const cert = {
        id: 'cert1', code: 'ABC', userId: 'u1', courseId: 'c1', studentName: 'Ana Maria', courseTitle: 'Curso', hours: 1, cpf: '12345678900',
        coordinatorName: null, coordinatorRole: null, coordinatorSignaturePath: null, status: 'issued', pdfPath: null, issuedAt: new Date(),
      }
      withQueryResults(
        db,
        [foraDoAr],
        [{ id: 'cert1' }], // já emitido: o curso fora do ar não barra
        [{ id: 'e1', source: 'free', orderId: null, settledAt: null }],
        [{ total: 1, dur: 3600 }],
        [{ n: 1 }],
        [cert],
        [{ uid: 'u1', displayName: 'Ana Maria', cpf: '12345678900' }],
        undefined
      )
      await expect(service.issueOrGet(POLO_A, 'u1', 'curso')).resolves.toBeInstanceOf(Buffer)
      expect(db.insert).not.toHaveBeenCalled()
    })

    it('sem certificado, o matriculado recebe 403 COURSE_UNAVAILABLE na emissão e no status, e nada é emitido', async () => {
      const a = make()
      withQueryResults(a.db, [foraDoAr], [], [{ id: 'e1' }])
      await expect(a.service.issueOrGet(POLO_A, 'u1', 'curso')).rejects.toMatchObject({ response: AVISO_POLO })
      expect(a.db.insert).not.toHaveBeenCalled()
      const b = make()
      withQueryResults(b.db, [foraDoAr], [], [{ id: 'e1' }])
      await expect(b.service.settlementFor(POLO_A, 'u1', 'curso')).rejects.toMatchObject({ response: AVISO_POLO })
      const matriz = make()
      withQueryResults(matriz.db, [foraDoAr], [], [{ id: 'e1' }])
      await expect(matriz.service.issueOrGet({ id: 't-m', isMatriz: true }, 'u1', 'curso')).rejects.toMatchObject({
        response: { code: 'COURSE_UNAVAILABLE', message: 'Este curso está indisponível no momento.' },
      })
    })

    it('sem certificado e sem matrícula ativa: 404, como se o curso não existisse', async () => {
      for (const metodo of ['issueOrGet', 'settlementFor'] as const) {
        const { db, service } = make()
        withQueryResults(db, [foraDoAr], [], [])
        await expect(service[metodo](POLO_A, 'u1', 'curso')).rejects.toBeInstanceOf(NotFoundException)
      }
    })
  })

  it('slugOf resolve o id DENTRO do polo e devolve o slug', async () => {
    const { db, scope, service } = make()
    const byId = jest.spyOn(scope, 'byId')
    withQueryResults(db, [course])
    expect(await service.slugOf('t-a', 'c1')).toBe('curso')
    expect(byId).toHaveBeenCalledWith('t-a', 'c1')
    expect(allWheres(db.where)[0].params).toEqual(['t-a', 'c1'])
  })

  it('slugOf de curso de outro polo → 404', async () => {
    const { db, service } = make()
    withQueryResults(db, [])
    await expect(service.slugOf('t-a', 'c-do-b')).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('URL de verificação impressa no QR', () => {
  // Fixa no domínio da matriz (ou em WEB_PUBLIC_URL), nunca no endereço do polo: o PDF impresso
  // tem que continuar verificável mesmo que o polo troque de domínio ou seja suspenso.
  const emitido = { id: 'x1', userId: 'u1', courseId: 'c1', code: 'ABC', studentName: 'Ana', courseTitle: 'Curso', hours: 2, cpf: '12345678900', status: 'issued', pdfPath: null, issuedAt: new Date() }
  const qrDe = async (url: string): Promise<string> =>
    `data:image/svg+xml;base64,${Buffer.from(await QRCode.toString(url, { type: 'svg', margin: 1, width: 240 })).toString('base64')}`

  it('sem WEB_PUBLIC_URL usa o domínio da matriz, e o QR codifica exatamente essa URL', async () => {
    const { db, pdf, config, service } = make()
    config.get.mockImplementation(() => undefined)
    withQueryResults(db, [emitido])
    await service.getDocumentByCode('ABC')
    const url = 'https://cursos.studiopilari.com.br/certificado/ABC'
    expect(pdf.generate).toHaveBeenCalledWith(expect.objectContaining({ verifyUrl: url, qrDataUri: await qrDe(url) }), expect.any(String))
  })

  it('com WEB_PUBLIC_URL usa o configurado, sem barra sobrando', async () => {
    const { db, pdf, config, service } = make()
    config.get.mockImplementation((k: string) => (k === 'WEB_PUBLIC_URL' ? 'https://cursos.studiopilari.com.br/' : undefined))
    withQueryResults(db, [emitido])
    await service.getDocumentByCode('ABC')
    const url = 'https://cursos.studiopilari.com.br/certificado/ABC'
    expect(pdf.generate).toHaveBeenCalledWith(expect.objectContaining({ verifyUrl: url, qrDataUri: await qrDe(url) }), expect.any(String))
  })

  it('a emissão feita num polo imprime o mesmo domínio fixo, não o do polo', async () => {
    const { db, pdf, config, service } = make()
    config.get.mockImplementation(() => undefined)
    withQueryResults(
      db,
      [course], [{ id: 'e1' }], [{ total: 2, dur: 7200 }], [{ n: 2 }], [],
      [{ uid: 'u1', displayName: 'Ana', email: 'a@x.com', cpf: '12345678900' }],
      undefined, undefined
    )
    await service.issueOrGet({ id: 't-polo-a', isMatriz: false }, 'u1', 'curso')
    expect(pdf.generate).toHaveBeenCalledWith(
      expect.objectContaining({ verifyUrl: expect.stringMatching(/^https:\/\/cursos\.studiopilari\.com\.br\/certificado\/[0-9A-F]{32}$/) }),
      expect.any(String)
    )
  })
})

describe('rubrica do coordenador só é lida do prefixo do PRÓPRIO curso', () => {
  // A rubrica é lida do bucket com a service account (acesso ao bucket inteiro). O caminho guardado — no
  // curso, no snapshot congelado do certificado ou no preview do modelo — só vale sob
  // cursos/<id do curso do certificado>/. Fora disso o PDF sai com o nome do coordenador e SEM a imagem.
  // Valores NOVOS já são barrados na gravação (Task 14); isto fecha os legados e os congelados.
  const PROPRIA = 'cursos/c1/signature/jane.png'
  const FORA: Array<[string, string]> = [
    ['de outro curso (outro polo)', 'cursos/c-do-outro-polo/signature/jane.png'],
    ['com prefixo parecido, sem a barra', 'cursos/c1x/signature/jane.png'],
    ['só a pasta do curso, sem a barra', 'cursos/c1'],
    ['fora de cursos/', 'assinaturas/diretora.png'],
    ['de um PDF de certificado', 'certificates/x2/OUTRO.pdf'],
    ['de URL externa', 'https://exemplo.com/rubrica.png'],
  ]
  const png = { buffer: Buffer.from('PNG'), contentType: 'image/png' }
  /** Lê SÓ o caminho dado: qualquer outro (inclusive o cache do PDF público) é "não existe". */
  const soLe = (caminho: string) => (async (p: string) => (p === caminho ? png : null)) as never
  const emitido = (over: Record<string, unknown> = {}) => ({
    id: 'x1', userId: 'u1', courseId: 'c1', code: 'ABC', studentName: 'Ana', courseTitle: 'Curso', hours: 2,
    cpf: '12345678900', coordinatorName: 'Jane Veck', coordinatorRole: 'Coordenadora do Curso',
    coordinatorSignaturePath: PROPRIA, status: 'issued', pdfPath: null, issuedAt: new Date(), ...over,
  })
  const comCoordenador = (over: Record<string, unknown> = {}) => ({
    ...course, coordinatorName: 'Jane Veck', coordinatorRole: 'Coordenadora do Curso', coordinatorSignaturePath: null, ...over,
  })
  const doAluno = [{ uid: 'u1', displayName: 'Ana', email: 'a@x.com', cpf: '12345678900' }]
  const imagemPng = `data:image/png;base64,${Buffer.from('PNG').toString('base64')}`

  describe('PDF público (re-render pelo código do QR)', () => {
    it('caminho do próprio curso: a imagem é lida e entra no PDF', async () => {
      const { db, gcs, pdf, service } = make()
      gcs.readObject.mockImplementation(soLe(PROPRIA))
      withQueryResults(db, [emitido()], [])
      await service.getDocumentByCode('ABC')
      expect(gcs.readObject).toHaveBeenCalledWith(PROPRIA, { maxBytes: MAX_IMAGE_BYTES })
      expect(pdf.generate).toHaveBeenCalledWith(expect.objectContaining({ coordinatorName: 'Jane Veck', coordinatorSignatureDataUri: imagemPng }), expect.any(String))
    })

    it.each(FORA)('rubrica congelada %s: não lê o objeto, mantém o nome e renderiza sem a imagem', async (_rotulo, caminho) => {
      const { db, gcs, pdf, service } = make()
      gcs.readObject.mockImplementation(soLe(caminho)) // se lesse, a imagem apareceria no PDF
      withQueryResults(db, [emitido({ coordinatorSignaturePath: caminho })], [])
      await service.getDocumentByCode('ABC')
      expect(caminhosLidos(gcs)).not.toContain(caminho)
      expect(pdf.generate).toHaveBeenCalledWith(
        expect.objectContaining({ coordinatorName: 'Jane Veck', coordinatorRole: 'Coordenadora do Curso', coordinatorSignatureDataUri: undefined }),
        expect.any(String)
      )
    })

    it('rubrica ATUAL do curso fora do prefixo (legado) também não é lida', async () => {
      // O re-render público troca a rubrica congelada pela atual do curso; o valor atual passa pelo mesmo crivo.
      const { db, gcs, pdf, service } = make()
      const alheia = 'cursos/c-do-outro-polo/signature/jane.png'
      gcs.readObject.mockImplementation(soLe(alheia))
      withQueryResults(db, [emitido({ coordinatorSignaturePath: null })], [{ name: 'Jane Veck', role: 'Coordenadora do Curso', signaturePath: alheia }])
      await service.getDocumentByCode('ABC')
      expect(caminhosLidos(gcs)).not.toContain(alheia)
      expect(pdf.generate).toHaveBeenCalledWith(expect.objectContaining({ coordinatorName: 'Jane Veck', coordinatorSignatureDataUri: undefined }), expect.any(String))
    })

    it('o crivo usa o curso do CERTIFICADO: caminho de um curso c2 num certificado do c1 é recusado', async () => {
      const { db, gcs, pdf, service } = make()
      const doC2 = 'cursos/c2/signature/jane.png'
      gcs.readObject.mockImplementation(soLe(doC2))
      withQueryResults(db, [emitido({ courseId: 'c1', coordinatorSignaturePath: doC2 })], [])
      await service.getDocumentByCode('ABC')
      expect(caminhosLidos(gcs)).not.toContain(doC2)
      expect(pdf.generate).toHaveBeenCalledWith(expect.objectContaining({ coordinatorSignatureDataUri: undefined }), expect.any(String))
    })
  })

  describe('emissão e reemissão (issueOrGet)', () => {
    it('primeira emissão com rubrica LEGADA de outro curso no cadastro: não lê, e o PDF sai só com o nome', async () => {
      const alheia = 'cursos/c-do-outro-polo/signature/jane.png'
      const { db, gcs, pdf, service } = make()
      gcs.readObject.mockImplementation(soLe(alheia))
      withQueryResults<unknown>(
        db,
        [comCoordenador({ coordinatorSignaturePath: alheia })], [{ id: 'e1' }], [{ total: 2, dur: 7200 }], [{ n: 2 }], [],
        doAluno, undefined, undefined
      )
      await service.issueOrGet(POLO_A, 'u1', 'curso')
      expect(caminhosLidos(gcs)).not.toContain(alheia)
      expect(pdf.generate).toHaveBeenCalledWith(
        expect.objectContaining({ coordinatorName: 'Jane Veck', coordinatorSignatureDataUri: undefined }),
        expect.any(String)
      )
    })

    it('primeira emissão com rubrica do PRÓPRIO curso: a imagem entra', async () => {
      const { db, gcs, pdf, service } = make()
      gcs.readObject.mockImplementation(soLe(PROPRIA))
      withQueryResults<unknown>(
        db,
        [comCoordenador({ coordinatorSignaturePath: PROPRIA })], [{ id: 'e1' }], [{ total: 2, dur: 7200 }], [{ n: 2 }], [],
        doAluno, undefined, undefined
      )
      await service.issueOrGet(POLO_A, 'u1', 'curso')
      expect(pdf.generate).toHaveBeenCalledWith(expect.objectContaining({ coordinatorSignatureDataUri: imagemPng }), expect.any(String))
    })

    it.each(FORA)('rubrica congelada %s num certificado já emitido: reemitir não a lê', async (_rotulo, caminho) => {
      const { db, gcs, pdf, service } = make()
      gcs.readObject.mockImplementation(soLe(caminho))
      withQueryResults<unknown>(
        db,
        [comCoordenador()], [{ id: 'e1' }], [{ total: 2, dur: 7200 }], [{ n: 2 }],
        [emitido({ coordinatorSignaturePath: caminho })],
        doAluno, undefined
      )
      await service.issueOrGet(POLO_A, 'u1', 'curso')
      expect(caminhosLidos(gcs)).not.toContain(caminho)
      expect(pdf.generate).toHaveBeenCalledWith(
        expect.objectContaining({ coordinatorName: 'Jane Veck', coordinatorSignatureDataUri: undefined }),
        expect.any(String)
      )
    })

    it('congelada de outro curso mas o curso tem a sua: a sincronização troca pela do curso, que é lida', async () => {
      const alheia = 'cursos/c-do-outro-polo/signature/jane.png'
      const { db, gcs, pdf, service } = make()
      gcs.readObject.mockImplementation(soLe(PROPRIA))
      withQueryResults<unknown>(
        db,
        [comCoordenador({ coordinatorSignaturePath: PROPRIA })], [{ id: 'e1' }], [{ total: 2, dur: 7200 }], [{ n: 2 }],
        [emitido({ coordinatorSignaturePath: alheia })],
        doAluno, undefined
      )
      await service.issueOrGet(POLO_A, 'u1', 'curso')
      expect(gcs.readObject).toHaveBeenCalledWith(PROPRIA, { maxBytes: MAX_IMAGE_BYTES })
      expect(caminhosLidos(gcs)).not.toContain(alheia)
      expect(pdf.generate).toHaveBeenCalledWith(expect.objectContaining({ coordinatorSignatureDataUri: imagemPng }), expect.any(String))
    })
  })

  describe('preview do modelo (coordinatorOf)', () => {
    it('rubrica do curso previsto vira data URI', async () => {
      const { db, gcs, service } = make()
      gcs.readObject.mockImplementation(soLe(PROPRIA))
      withQueryResults(db, [{ name: 'Jane Veck', role: 'Coordenadora do Curso', assinatura: PROPRIA }])
      expect(await service.coordinatorOf('c1')).toEqual({ name: 'Jane Veck', role: 'Coordenadora do Curso', signatureDataUri: imagemPng })
    })

    it.each(FORA)('rubrica %s: devolve nome e cargo, sem imagem, e não lê o objeto', async (_rotulo, caminho) => {
      const { db, gcs, service } = make()
      gcs.readObject.mockImplementation(soLe(caminho))
      withQueryResults(db, [{ name: 'Jane Veck', role: 'Coordenadora do Curso', assinatura: caminho }])
      expect(await service.coordinatorOf('c1')).toEqual({ name: 'Jane Veck', role: 'Coordenadora do Curso', signatureDataUri: undefined })
      expect(gcs.readObject).not.toHaveBeenCalled()
    })

    it('o crivo usa o curso PREVISTO: caminho do c1 no preview do c2 é recusado', async () => {
      const { db, gcs, service } = make()
      gcs.readObject.mockImplementation(soLe(PROPRIA))
      withQueryResults(db, [{ name: 'Jane Veck', role: null, assinatura: PROPRIA }])
      expect((await service.coordinatorOf('c2'))?.signatureDataUri).toBeUndefined()
      expect(gcs.readObject).not.toHaveBeenCalled()
    })

    it('curso sem nome de coordenador → null (sem preview de assinatura)', async () => {
      const { db, service } = make()
      withQueryResults(db, [{ name: null, role: null, assinatura: PROPRIA }])
      expect(await service.coordinatorOf('c1')).toBeNull()
    })
  })
})
